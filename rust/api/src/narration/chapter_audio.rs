//! Streaming assembly of already verified, immutable narration units.
//!
//! The caller owns disk reservations, the private parent directory, and exclusive
//! publication of a destination. No source is removed and no provider is called.
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

const HEADER_BYTES: u64 = 44;
const BUFFER_BYTES: usize = 64 * 1024;
static SCRATCH_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AudioMetadata {
    pub bytes: u64,
    pub pcm_bytes: u64,
    /// Mono samples at 24,000 Hz. Duration is `samples / 24_000` seconds.
    pub samples: u64,
}

fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

fn metadata(pcm_bytes: u64, max_bytes: u64) -> io::Result<AudioMetadata> {
    if pcm_bytes == 0 || pcm_bytes % 2 != 0 || pcm_bytes > u64::from(u32::MAX) - 36 {
        return Err(invalid("invalid or oversized chapter PCM length"));
    }
    let bytes = pcm_bytes
        .checked_add(HEADER_BYTES)
        .ok_or_else(|| invalid("chapter length overflow"))?;
    if bytes > max_bytes {
        return Err(invalid("chapter exceeds reserved output limit"));
    }
    Ok(AudioMetadata {
        bytes,
        pcm_bytes,
        samples: pcm_bytes / 2,
    })
}

fn header(pcm_bytes: u64) -> [u8; 44] {
    // All callers first validate RIFF32 bounds through metadata().
    let mut value = [0; 44];
    value[..4].copy_from_slice(b"RIFF");
    value[4..8].copy_from_slice(&((pcm_bytes + 36) as u32).to_le_bytes());
    value[8..16].copy_from_slice(b"WAVEfmt ");
    value[16..20].copy_from_slice(&16u32.to_le_bytes());
    value[20..22].copy_from_slice(&1u16.to_le_bytes());
    value[22..24].copy_from_slice(&1u16.to_le_bytes());
    value[24..28].copy_from_slice(&24_000u32.to_le_bytes());
    value[28..32].copy_from_slice(&48_000u32.to_le_bytes());
    value[32..34].copy_from_slice(&2u16.to_le_bytes());
    value[34..36].copy_from_slice(&16u16.to_le_bytes());
    value[36..40].copy_from_slice(b"data");
    value[40..44].copy_from_slice(&(pcm_bytes as u32).to_le_bytes());
    value
}

// Leaves the file positioned immediately after its canonical header.
fn inspect(file: &mut File) -> io::Result<AudioMetadata> {
    let stat = file.metadata()?;
    if !stat.is_file() {
        return Err(invalid("narration unit must be a regular file"));
    }
    let mut bytes = [0; 44];
    file.read_exact(&mut bytes)?;
    let pcm_bytes = u64::from(u32::from_le_bytes(bytes[40..44].try_into().unwrap()));
    let info = metadata(pcm_bytes, u64::MAX)?;
    if bytes != header(pcm_bytes) || stat.len() != info.bytes {
        return Err(invalid("incompatible or incomplete narration WAV"));
    }
    Ok(info)
}

fn open_part(path: &Path) -> io::Result<File> {
    if !fs::symlink_metadata(path)?.file_type().is_file() {
        return Err(invalid(
            "narration unit must not be a symlink or special file",
        ));
    }
    File::open(path)
}

/// Validate one canonical 24kHz mono PCM16 WAV without loading its audio.
pub fn inspect_part(path: &Path) -> io::Result<AudioMetadata> {
    inspect(&mut open_part(path)?)
}

/// Inspect all units and compute the one-header chapter size before reserving it.
pub fn inspect_parts(parts: &[PathBuf], max_bytes: u64) -> io::Result<AudioMetadata> {
    let mut pcm_bytes = 0u64;
    for path in parts {
        pcm_bytes = pcm_bytes
            .checked_add(inspect_part(path)?.pcm_bytes)
            .ok_or_else(|| invalid("chapter length overflow"))?;
        // Reject early, including RIFF32 overflow, even on very large lists.
        metadata(pcm_bytes, max_bytes)?;
    }
    metadata(pcm_bytes, max_bytes)
}

struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn scratch(destination: &Path) -> io::Result<(Scratch, File)> {
    let parent = destination
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| invalid("chapter destination requires a parent directory"))?;
    let name = destination
        .file_name()
        .ok_or_else(|| invalid("invalid chapter destination"))?;
    for _ in 0..32 {
        let sequence = SCRATCH_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let mut name = name.to_os_string();
        name.push(format!(".{}.{sequence}.partial", std::process::id()));
        let path = parent.join(name);
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&path) {
            Ok(file) => return Ok((Scratch(path), file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "chapter scratch names occupied",
    ))
}

fn check_cancelled(cancelled: &impl Fn() -> bool) -> io::Result<()> {
    if cancelled() {
        Err(io::Error::new(
            io::ErrorKind::Interrupted,
            "chapter assembly cancelled",
        ))
    } else {
        Ok(())
    }
}

/// Publish one contiguous WAV from ordered immutable units with bounded memory.
///
/// `max_bytes` includes the 44-byte output header. Reserve that extra disk space
/// before calling. Existing destinations are rejected; the caller must serialize
/// writers in this private directory. Errors never publish partial audio. A
/// directory-sync error after rename can leave a complete file at destination;
/// callers can inspect that file before retrying. Cancellation is cooperative
/// through the final pre-rename check; after rename publication has committed.
pub fn assemble(
    parts: &[PathBuf],
    destination: &Path,
    max_bytes: u64,
    cancelled: impl Fn() -> bool,
) -> io::Result<AudioMetadata> {
    check_cancelled(&cancelled)?;
    let info = inspect_parts(parts, max_bytes)?;
    match fs::symlink_metadata(destination) {
        Ok(_) => {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "chapter already exists",
            ))
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    check_cancelled(&cancelled)?;
    let (scratch, mut output) = scratch(destination)?;
    output.write_all(&header(info.pcm_bytes))?;
    let mut buffer = [0; BUFFER_BYTES];
    let mut total = 0u64;
    for path in parts {
        check_cancelled(&cancelled)?;
        let mut input = open_part(path)?;
        let part = inspect(&mut input)?;
        let mut remaining = part.pcm_bytes;
        while remaining != 0 {
            check_cancelled(&cancelled)?;
            let size = usize::try_from(remaining.min(BUFFER_BYTES as u64)).unwrap();
            input.read_exact(&mut buffer[..size])?;
            let next_total = total
                .checked_add(size as u64)
                .ok_or_else(|| invalid("chapter length overflow"))?;
            if next_total > info.pcm_bytes {
                return Err(invalid("narration unit changed during assembly"));
            }
            output.write_all(&buffer[..size])?;
            remaining -= size as u64;
            total = next_total;
        }
        if input.read(&mut buffer[..1])? != 0 || input.metadata()?.len() != part.bytes {
            return Err(invalid("narration unit changed during assembly"));
        }
    }
    if total != info.pcm_bytes {
        return Err(invalid("narration units changed during assembly"));
    }
    check_cancelled(&cancelled)?;
    output.sync_all()?;
    drop(output);
    check_cancelled(&cancelled)?;
    // Recheck after the potentially slow copy; caller still serializes writers.
    match fs::symlink_metadata(destination) {
        Ok(_) => {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "chapter already exists",
            ))
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    fs::rename(&scratch.0, destination)?;
    File::open(destination.parent().unwrap())?.sync_all()?;
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let sequence = SCRATCH_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir()
                .join(format!("cc-chapter-wav-{}-{sequence}", std::process::id()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn part(&self, name: &str, samples: &[i16]) -> PathBuf {
            let path = self.0.join(name);
            let mut bytes = header((samples.len() * 2) as u64).to_vec();
            for sample in samples {
                bytes.extend_from_slice(&sample.to_le_bytes());
            }
            fs::write(&path, bytes).unwrap();
            path
        }
        fn destination(&self) -> PathBuf {
            self.0.join("chapter.wav")
        }
        fn no_partials(&self) {
            assert!(fs::read_dir(&self.0).unwrap().all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".partial")));
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn assembles_one_header_in_order_with_exact_duration_and_private_permissions() {
        let fixture = Fixture::new();
        let first = vec![1234; 24_000];
        let second = vec![-4321; 48_000];
        let parts = vec![
            fixture.part("a.wav", &first),
            fixture.part("b.wav", &second),
        ];
        let output = fixture.destination();
        let info = assemble(&parts, &output, 144_044, || false).unwrap();
        assert_eq!(
            info,
            AudioMetadata {
                bytes: 144_044,
                pcm_bytes: 144_000,
                samples: 72_000
            }
        );
        assert_eq!(info.samples / 24_000, 3);
        assert_eq!(inspect_part(&output).unwrap(), info);
        let bytes = fs::read(output).unwrap();
        let decoded: Vec<i16> = bytes[44..]
            .chunks_exact(2)
            .map(|s| i16::from_le_bytes([s[0], s[1]]))
            .collect();
        assert_eq!(decoded, [first, second].concat());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(fixture.destination())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        fixture.no_partials();
    }

    #[test]
    fn rejects_missing_truncated_incompatible_and_extra_bytes_without_publication() {
        for mutation in 0..5 {
            let fixture = Fixture::new();
            let part = fixture.part("unit.wav", &[7, 8]);
            match mutation {
                0 => fs::remove_file(&part).unwrap(),
                1 => {
                    OpenOptions::new()
                        .write(true)
                        .open(&part)
                        .unwrap()
                        .set_len(45)
                        .unwrap();
                }
                2 => {
                    let mut bytes = fs::read(&part).unwrap();
                    bytes[24] = 0;
                    fs::write(&part, bytes).unwrap();
                }
                3 => {
                    let mut bytes = fs::read(&part).unwrap();
                    bytes.push(0);
                    fs::write(&part, bytes).unwrap();
                }
                _ => {
                    let mut bytes = fs::read(&part).unwrap();
                    bytes[4] = 0;
                    fs::write(&part, bytes).unwrap();
                }
            }
            assert!(assemble(&[part], &fixture.destination(), 1000, || false).is_err());
            assert!(!fixture.destination().exists());
            fixture.no_partials();
        }
    }

    #[test]
    fn rejects_empty_odd_oversized_and_riff_overflow() {
        assert!(metadata(0, u64::MAX).is_err());
        assert!(metadata(3, u64::MAX).is_err());
        assert!(metadata(2, 45).is_err());
        assert!(metadata(u64::from(u32::MAX) - 35, u64::MAX).is_err());
        assert!(metadata(u64::MAX, u64::MAX).is_err());
        let fixture = Fixture::new();
        let part = fixture.part("a.wav", &[1, 2]);
        assert!(assemble(&[part], &fixture.destination(), 47, || false).is_err());
        assert!(assemble(&[], &fixture.destination(), 1000, || false).is_err());
        assert!(!fixture.destination().exists());
        fixture.no_partials();
    }

    #[test]
    fn cancellation_at_every_stage_removes_scratch_and_preserves_units() {
        for cancel_at in 1..=9 {
            let fixture = Fixture::new();
            let part = fixture.part("a.wav", &vec![1; 100_000]);
            let calls = Cell::new(0);
            let result = assemble(&[part.clone()], &fixture.destination(), 1_000_000, || {
                calls.set(calls.get() + 1);
                calls.get() == cancel_at
            });
            assert_eq!(
                result.unwrap_err().kind(),
                io::ErrorKind::Interrupted,
                "cancel at {cancel_at}"
            );
            assert!(!fixture.destination().exists());
            assert!(inspect_part(&part).is_ok());
            fixture.no_partials();
        }
    }

    #[test]
    fn mid_copy_truncation_fails_cleanly() {
        let fixture = Fixture::new();
        let part = fixture.part("a.wav", &vec![1; 100_000]);
        let calls = Cell::new(0);
        let result = assemble(&[part.clone()], &fixture.destination(), 1_000_000, || {
            calls.set(calls.get() + 1);
            if calls.get() == 5 {
                OpenOptions::new()
                    .write(true)
                    .open(&part)
                    .unwrap()
                    .set_len(44)
                    .unwrap();
            }
            false
        });
        assert!(result.is_err());
        assert!(!fixture.destination().exists());
        fixture.no_partials();
    }

    #[test]
    fn rejects_grown_part_before_exceeding_reserved_output() {
        let fixture = Fixture::new();
        let part = fixture.part("a.wav", &[1, 2]);
        let calls = Cell::new(0);
        let result = assemble(&[part], &fixture.destination(), 48, || {
            calls.set(calls.get() + 1);
            if calls.get() == 3 {
                fixture.part("a.wav", &[1, 2, 3]);
            }
            false
        });
        assert!(result.is_err());
        assert!(!fixture.destination().exists());
        fixture.no_partials();
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlink_inputs_or_destinations() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        let part = fixture.part("a.wav", &[1, 2]);
        let link = fixture.0.join("link.wav");
        symlink(&part, &link).unwrap();
        assert!(inspect_part(&link).is_err());
        assert!(assemble(&[link], &fixture.destination(), 1000, || false).is_err());
        symlink(&part, fixture.destination()).unwrap();
        assert_eq!(
            assemble(&[part.clone()], &fixture.destination(), 1000, || false)
                .unwrap_err()
                .kind(),
            io::ErrorKind::AlreadyExists
        );
        assert!(inspect_part(&part).is_ok());
        fixture.no_partials();
    }

    #[test]
    fn existing_destination_and_publish_failure_are_preserved_and_cleaned() {
        let fixture = Fixture::new();
        let part = fixture.part("a.wav", &[1, 2]);
        fs::write(fixture.destination(), b"existing").unwrap();
        assert_eq!(
            assemble(&[part.clone()], &fixture.destination(), 1000, || false)
                .unwrap_err()
                .kind(),
            io::ErrorKind::AlreadyExists
        );
        assert_eq!(fs::read(fixture.destination()).unwrap(), b"existing");
        fs::remove_file(fixture.destination()).unwrap();
        let calls = Cell::new(0);
        assert!(assemble(&[part], &fixture.destination(), 1000, || {
            calls.set(calls.get() + 1);
            if calls.get() == 6 {
                fs::create_dir(fixture.destination()).unwrap();
            }
            false
        })
        .is_err());
        assert!(fixture.destination().is_dir());
        fixture.no_partials();
    }
}
