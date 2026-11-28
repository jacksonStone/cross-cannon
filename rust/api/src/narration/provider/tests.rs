use super::*;
use tokio::net::TcpListener;
use tokio_tungstenite::accept_async;

const SOURCE: &str = "The Lord is my shepherd; I shall not want.";

fn speech_event(kind: &str) -> Value {
    json!({"type":kind,"response_id":"resp_local","item_id":"item_local","output_index":0,"content_index":0})
}

fn successful_events(transcript: &str) -> Vec<Value> {
    // A real, decodable PCM sine wave (100 ms), not a marker masquerading as
    // audio. All transport events follow the documented GA Realtime protocol.
    let pcm = (0..2400)
        .flat_map(|n| {
            let sample =
                (((n as f64 * 440.0 * std::f64::consts::TAU / 24000.0).sin()) * 2000.0) as i16;
            sample.to_le_bytes()
        })
        .collect::<Vec<_>>();
    let mut delta = speech_event("response.output_audio.delta");
    delta["delta"] = json!(STANDARD.encode(&pcm));
    let mut transcript_delta = speech_event("response.output_audio_transcript.delta");
    transcript_delta["delta"] = json!(transcript);
    let mut transcript_done = speech_event("response.output_audio_transcript.done");
    transcript_done["transcript"] = json!(transcript);
    vec![
        json!({"type":"response.created","response":{"id":"resp_local","status":"in_progress"}}),
        delta,
        transcript_delta,
        speech_event("response.output_audio.done"),
        transcript_done,
        json!({"type":"response.done","response":{
            "id":"resp_local","status":"completed",
            "output":[{"id":"item_local","type":"message","status":"completed","role":"assistant",
                "content":[{"type":"output_audio","transcript":transcript}]}],
            "usage":{"input_tokens":100,"output_tokens":50,"output_token_details":{"audio_tokens":45}}
        }}),
    ]
}

async fn mock_provider(events: Vec<Value>) -> (ProviderConfig, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let handle = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut ws = accept_async(stream).await.unwrap();
        send(
            &mut ws,
            json!({"type":"session.created","session":{"id":"sess_local"}}),
        )
        .await
        .unwrap();
        let update: Value =
            serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(update["type"], "session.update");
        assert_eq!(update["session"]["model"], "gpt-realtime-2.1-mini");
        assert_eq!(update["session"]["output_modalities"], json!(["audio"]));
        assert_eq!(
            update["session"]["audio"]["output"]["format"],
            json!({"type":"audio/pcm","rate":24000})
        );
        assert_eq!(update["session"]["max_output_tokens"], 2048);
        assert_eq!(update["session"]["tools"], json!([]));
        assert_eq!(
            update["session"]["audio"]["input"]["turn_detection"],
            Value::Null
        );
        send(
            &mut ws,
            json!({"type":"session.updated","session":update["session"]}),
        )
        .await
        .unwrap();
        let response: Value =
            serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(response["type"], "response.create");
        assert_eq!(response["response"]["conversation"], "none");
        assert_eq!(response["response"]["tools"], json!([]));
        assert_eq!(response["response"]["input"].as_array().unwrap().len(), 1);
        assert_eq!(
            response["response"]["input"][0]["content"][0]["text"],
            SOURCE
        );
        assert!(response["response"]["instructions"]
            .as_str()
            .unwrap()
            .contains("verbatim"));
        for event in events {
            if send(&mut ws, event).await.is_err() {
                break;
            }
        }
        // Acknowledge the client's close frame without holding synthesis open.
        let _ = ws.next().await;
        let _ = ws.close(None).await;
    });
    (ProviderConfig::loopback(format!("ws://{address}")), handle)
}

#[tokio::test]
async fn realtime_socket_generates_exact_decodable_wav_and_reports_usage() {
    let (provider, handle) = mock_provider(successful_events(SOURCE)).await;
    let generated = synthesize(&provider, &SpeechSettings::default(), SOURCE)
        .await
        .unwrap();
    assert_eq!(generated.transcript, SOURCE);
    assert_eq!(
        generated.usage,
        SpeechUsage {
            input_tokens: 100,
            output_tokens: 50,
            audio_output_tokens: 45
        }
    );
    assert_eq!(&generated.wav[..12], b"RIFF\xE4\x12\0\0WAVE");
    assert_eq!(&generated.wav[36..40], b"data");
    assert_eq!(
        u32::from_le_bytes(generated.wav[24..28].try_into().unwrap()),
        24000
    );
    assert_eq!(generated.wav.len(), 4844);
    assert!(generated.wav[44..].iter().any(|b| *b != 0));
    handle.await.unwrap();
}

#[tokio::test]
async fn wrong_words_never_return_audio_for_cache_or_playback() {
    let (provider, handle) = mock_provider(successful_events(
        "The Lord is my shepherd; I want nothing.",
    ))
    .await;
    assert!(matches!(
        synthesize(&provider, &SpeechSettings::default(), SOURCE).await,
        Err(ProviderError::TranscriptMismatch)
    ));
    handle.await.unwrap();
}

#[tokio::test]
async fn truncated_output_or_missing_transcript_is_not_success() {
    for mode in [
        "incomplete",
        "cancelled",
        "missing_transcript",
        "missing_audio_done",
    ] {
        let mut events = successful_events(SOURCE);
        match mode {
            "incomplete" | "cancelled" => {
                events.last_mut().unwrap()["response"]["status"] = json!(mode)
            }
            "missing_transcript" => {
                events.retain(|e| !e["type"].as_str().unwrap().contains("transcript"))
            }
            _ => events.retain(|e| e["type"] != "response.output_audio.done"),
        }
        let (provider, handle) = mock_provider(events).await;
        assert!(
            synthesize(&provider, &SpeechSettings::default(), SOURCE)
                .await
                .is_err(),
            "{mode}"
        );
        handle.await.unwrap();
    }
}

#[tokio::test]
async fn mismatched_response_identity_and_upstream_error_are_redacted() {
    let mut wrong = successful_events(SOURCE);
    wrong[1]["response_id"] = json!("another_response");
    for (events, expected) in [
        (wrong, ProviderError::Protocol),
        (
            vec![
                json!({"type":"error","error":{"message":"sensitive upstream body and supplied text"}}),
            ],
            ProviderError::Unavailable,
        ),
    ] {
        let (provider, handle) = mock_provider(events).await;
        let result = synthesize(&provider, &SpeechSettings::default(), SOURCE).await;
        let error = match result {
            Err(error) => error,
            Ok(_) => panic!("unsafe provider response accepted"),
        };
        assert_eq!(error, expected);
        assert!(!error.to_string().contains("sensitive"));
        handle.await.unwrap();
    }
}

#[tokio::test]
async fn invalid_settings_and_oversized_text_do_not_connect() {
    // Nothing listens here: any attempted paid/provider network request would
    // produce the wrong error instead of passing this preflight test.
    let provider = ProviderConfig::loopback("ws://127.0.0.1:1".into());
    for settings in [
        SpeechSettings {
            model: "tts-1".into(),
            ..Default::default()
        },
        SpeechSettings {
            voice: "unknown".into(),
            ..Default::default()
        },
        SpeechSettings {
            speed: f64::NAN,
            ..Default::default()
        },
    ] {
        assert!(matches!(
            synthesize(&provider, &settings, SOURCE).await,
            Err(ProviderError::InvalidInput)
        ));
    }
    let text = "x".repeat(MAX_INPUT_CHARS + 1);
    assert!(matches!(
        synthesize(&provider, &SpeechSettings::default(), &text).await,
        Err(ProviderError::InvalidInput)
    ));
    assert!(!format!("{provider:?}").contains("test-only-local-provider"));
}

#[test]
fn transcript_gate_preserves_words_and_boundaries() {
    assert!(transcript_matches(
        "Our Father, who art in Heaven.",
        "our father who art in heaven"
    ));
    assert!(transcript_matches("God’s mercy.", "God's mercy!"));
    for (source, transcript) in [
        ("a part", "apart"),
        ("new breadth", "new piece of cloth"),
        ("one two three", "one three"),
        ("one two", "two one"),
        ("one", "Certainly. One."),
        ("123", "one hundred twenty three"),
        ("", ""),
    ] {
        assert!(!transcript_matches(source, transcript));
    }
}

#[test]
fn actual_on_prayer_canary_ignores_sentence_punctuation_boundaries() {
    let canary: Value =
        serde_json::from_str(include_str!("../fixtures/on-prayer-canary.json")).unwrap();
    assert!(transcript_matches(
        canary["source"].as_str().unwrap(),
        canary["transcript"].as_str().unwrap(),
    ));
}

#[test]
fn typography_does_not_change_word_identity() {
    for (source, transcript) in [
        (
            "Heaven—hallowed be thy name.",
            "heaven hallowed be thy name",
        ),
        (
            "Father:your kingdom;your will.",
            "Father your kingdom your will",
        ),
        ("“The Word”…(and life).", "The Word and life"),
        ("God’s well‐beloved Son", "God's well-beloved Son"),
        ("Godʼs mercy", "God's mercy"),
        ("the first‑born", "the first-born"),
        ("’Tis the disciples’ prayer", "'tis the disciples' prayer"),
    ] {
        assert!(
            transcript_matches(source, transcript),
            "{source:?} vs {transcript:?}"
        );
    }
    for (source, transcript) in [
        // Added, dropped, substituted, and reordered words remain failures.
        ("I shall not want.", "I shall want."),
        ("The Word was God.", "The Word was a God."),
        ("The Word was God.", "The Word was good."),
        ("Word of Reason", "Reason of Word"),
        ("new piece of cloth", "new breadth"),
        // Compound spelling and lexical boundaries are not interchangeable.
        ("re-sign", "resign"),
        ("well-being", "well being"),
        ("a part", "apart"),
        ("the first-born", "the first born"),
        ("God—Word", "GodWord"),
        // Apostrophe shape may vary; apostrophes and contractions may not vanish.
        ("God’s mercy", "Gods mercy"),
        ("can't", "cant"),
        ("can't", "cannot"),
        ("we’ll pray", "well pray"),
        ("’tis", "tis"),
        ("the disciples’ prayer", "the disciples prayer"),
        ("rock ’n’ roll", "rock n roll"),
        // Preserve Scripture vocabulary and numerals; never expand or paraphrase.
        ("Thou shalt not kill.", "You shall not kill."),
        (
            "In the beginning was the Word.",
            "In the beginning is the Word.",
        ),
        ("John 3:16", "John 316"),
        ("John 3:16", "John 3 16"),
        ("3.14", "3 14"),
        ("1,000", "1000"),
        ("one hundred", "100"),
        ("faith & hope", "faith hope"),
        ("", ""),
        ("—…!", ""),
    ] {
        assert!(
            !transcript_matches(source, transcript),
            "{source:?} vs {transcript:?}"
        );
        assert!(
            !transcript_matches(transcript, source),
            "reverse: {source:?} vs {transcript:?}"
        );
    }
}

#[test]
fn malformed_pcm_and_excessive_audio_are_rejected() {
    let mut a = AudioAccumulator::default();
    a.receive(&json!({"type":"response.created","response":{"id":"resp_local"}}))
        .unwrap();
    let mut event = speech_event("response.output_audio.delta");
    event["delta"] = json!("not base64");
    assert_eq!(a.receive(&event), Err(ProviderError::Protocol));
    a.pcm = vec![0; MAX_PCM_BYTES];
    event["delta"] = json!(STANDARD.encode([0, 1]));
    assert_eq!(a.receive(&event), Err(ProviderError::TooLarge));
    assert!(matches!(
        AudioAccumulator {
            pcm: vec![1],
            transcript: SOURCE.into(),
            transcript_done: true,
            audio_done: true,
            ..Default::default()
        }
        .finish(SOURCE),
        Err(ProviderError::Incomplete)
    ));
}
