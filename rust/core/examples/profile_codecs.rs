//! Compare lossless codecs against the actual v2 prepared text library.
use std::{io::Read, time::Instant};

fn main() -> anyhow::Result<()> {
    let path = std::env::args_os()
        .nth(1)
        .expect("existing gzip native-library.bin");
    let file = std::fs::read(path)?;
    anyhow::ensure!(
        file.starts_with(b"CCLIB\0\x02\0"),
        "Expected a v2 gzip library"
    );
    let start = Instant::now();
    let mut original = Vec::new();
    flate2::read::GzDecoder::new(&file[8..]).read_to_end(&mut original)?;
    println!(
        "gzip: {} bytes; {:.1}ms decode",
        file.len(),
        start.elapsed().as_secs_f64() * 1000.0
    );
    let start = Instant::now();
    let encoded = zstd::stream::encode_all(&original[..], 9)?;
    let encode = start.elapsed();
    let start = Instant::now();
    let decoded = zstd::stream::decode_all(&encoded[..])?;
    let decode = start.elapsed();
    anyhow::ensure!(decoded == original, "Codec changed native data");
    println!(
        "zstd: {} bytes; {:.1}ms decode; {:.1}s build-time encode; exact bytes retained",
        encoded.len(),
        decode.as_secs_f64() * 1000.0,
        encode.as_secs_f64()
    );
    Ok(())
}
