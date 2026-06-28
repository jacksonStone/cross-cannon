import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState
} from "react";

import type { BrowserPassage } from "~/lib/scripture-cache.server";

import { loadScriptureCache } from "./scripture-cache.client";

const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export type ScriptureLibraryStatus = "loading" | "startup" | "ready" | "error";
export type PassageLookup = ReadonlyMap<string, BrowserPassage>;

export type ScriptureLibrary = {
  error: Error | null;
  isFullCacheReady: boolean;
  isReaderReady: boolean;
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
  startupPassages?: BrowserPassage[];
  useStartupPassages?: boolean;
};

export function useScriptureLibrary({
  scriptureCacheUrl,
  startupPassages = [],
  useStartupPassages = false
}: UseScriptureLibraryOptions): ScriptureLibrary {
  const [snapshot, setSnapshot] = useState<ScriptureLibrarySnapshot>(() => ({
    error: null,
    passages: [],
    status: "loading"
  }));

  useBrowserLayoutEffect(() => {
    if (!useStartupPassages || startupPassages.length === 0) {
      return;
    }

    setSnapshot((current) => {
      if (current.status === "ready") {
        return current;
      }

      return {
        error: null,
        passages: startupPassages,
        status: "startup"
      };
    });
  }, [startupPassages, useStartupPassages]);

  useEffect(() => {
    let ignore = false;

    setSnapshot((current) => {
      if (
        useStartupPassages
        && startupPassages.length > 0
        && current.status !== "ready"
      ) {
        return {
          error: null,
          passages: startupPassages,
          status: "startup"
        };
      }

      return {
        error: null,
        passages: current.status === "ready" ? current.passages : [],
        status: "loading"
      };
    });

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
  }, [scriptureCacheUrl, startupPassages, useStartupPassages]);

  const passageLookup = useMemo(
    () => createPassageLookup(snapshot.passages),
    [snapshot.passages]
  );

  return {
    ...snapshot,
    isFullCacheReady: snapshot.status === "ready",
    isReaderReady: snapshot.passages.length > 0,
    passageLookup
  };
}

export function createPassageLookup(passages: BrowserPassage[]): PassageLookup {
  return new Map(passages.map((passage) => [passage.id, passage]));
}
