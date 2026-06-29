import {
  useEffect,
  useMemo,
  useState
} from "react";

import type { BrowserPassage } from "~/lib/scripture-cache.server";

import { loadScriptureCache } from "./scripture-cache.client";

export type ScriptureLibraryStatus = "loading" | "ready" | "error";
export type PassageLookup = ReadonlyMap<string, BrowserPassage>;

export type ScriptureLibrary = {
  error: Error | null;
  isReady: boolean;
  passageLookup: PassageLookup;
  passages: BrowserPassage[];
  status: ScriptureLibraryStatus;
};

type ScriptureLibrarySnapshot = {
  error: Error | null;
  passages: BrowserPassage[];
  status: ScriptureLibraryStatus;
};

type UseScriptureLibraryOptions = {
  scriptureCacheUrl: string;
};

export function useScriptureLibrary({
  scriptureCacheUrl
}: UseScriptureLibraryOptions): ScriptureLibrary {
  const [snapshot, setSnapshot] = useState<ScriptureLibrarySnapshot>(() => ({
    error: null,
    passages: [],
    status: "loading"
  }));

  useEffect(() => {
    let ignore = false;

    setSnapshot((current) => ({
      error: null,
      passages: current.status === "ready" ? current.passages : [],
      status: "loading"
    }));

    loadScriptureCache(scriptureCacheUrl)
      .then((loadedPassages) => {
        if (!ignore) {
          setSnapshot({
            error: null,
            passages: loadedPassages,
            status: "ready"
          });
        }
      })
      .catch((error: unknown) => {
        if (!ignore) {
          setSnapshot({
            error: error instanceof Error ? error : new Error(String(error)),
            passages: [],
            status: "error"
          });
        }
      });

    return () => {
      ignore = true;
    };
  }, [scriptureCacheUrl]);

  const passageLookup = useMemo(
    () => createPassageLookup(snapshot.passages),
    [snapshot.passages]
  );

  return {
    ...snapshot,
    isReady: snapshot.status === "ready",
    passageLookup
  };
}

export function createPassageLookup(passages: BrowserPassage[]): PassageLookup {
  return new Map(passages.map((passage) => [passage.id, passage]));
}
