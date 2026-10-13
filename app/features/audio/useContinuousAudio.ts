import { useEffect, useState } from "react";
import type { ContinuousAudioManifest } from "./continuous-audio";

const EMPTY_CHAPTERS: ContinuousAudioManifest["chapters"] = {};
let pending: Promise<ContinuousAudioManifest | null> | undefined;
export function useContinuousAudio() {
  const [manifest, setManifest] = useState<ContinuousAudioManifest | null>(
    null
  );
  useEffect(() => {
    let mounted = true;
    pending ??= fetch("/continuous-audio.json", { cache: "no-cache" })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((data: unknown): ContinuousAudioManifest | null => {
        if (
          !data ||
          typeof data !== "object" ||
          !("version" in data) ||
          data.version !== 1 ||
          !("chapters" in data) ||
          !data.chapters ||
          typeof data.chapters !== "object"
        )
          return null;
        for (const value of Object.values(data.chapters)) {
          if (
            !value ||
            typeof value !== "object" ||
            typeof value.url !== "string" ||
            !/^\/audio\/continuous\/[a-z0-9-]+\.m4a$/.test(value.url) ||
            !Number.isFinite(value.startSeconds) ||
            value.startSeconds < 0 ||
            !Number.isFinite(value.endSeconds) ||
            value.endSeconds <= value.startSeconds
          )
            return null;
        }
        return data as ContinuousAudioManifest;
      })
      .catch(() => null);
    void pending.then((value) => {
      if (mounted) setManifest(value);
    });
    return () => {
      mounted = false;
    };
  }, []);
  return manifest?.chapters ?? EMPTY_CHAPTERS;
}
