import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigationType } from "@remix-run/react";

import {
  initialSearchModalFlowState,
  searchModalFlowReducer,
  type SearchModalFlowAction,
  type SearchModalFlowState,
} from "./search-modal-flow";
import type { ChurchFathersActionData, SearchActionData } from "./types";

const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type SearchSnapshot<T> = {
  actionData?: T;
  flow: SearchModalFlowState;
  scrollTop: number;
};

// Each reader retains a bounded, tab-local cache of history entries. Result
// navigation must use Remix Links so Back can reuse the original response.
// Nothing is written on the server or persisted after a page reload.
function createSearchHistory<T>() {
  const entries = new Map<string, SearchSnapshot<T>>();

  return function useSearchHistory(incomingData: T | undefined, isReady: boolean) {
    const { key } = useLocation();
    const navigationType = useNavigationType();
    const searchBodyRef = useRef<HTMLDivElement>(null);
    const [session, setSession] = useState(() => ({
      key,
      incomingData,
      snapshot: {
        ...initialSnapshot(),
        ...(typeof window === "undefined" ? undefined : entries.get(key)),
        ...(incomingData ? { actionData: incomingData } : undefined),
      },
    }));

    // Select the destination entry before rendering its form/results. In
    // particular, POP must not inherit the most recent search's response.
    if (session.key !== key) {
      const snapshot = navigationType === "POP"
        ? entries.get(key) ?? initialSnapshot()
        : session.snapshot;
      setSession({
        key,
        incomingData,
        snapshot: incomingData
          ? { ...snapshot, actionData: incomingData, scrollTop: 0 }
          : snapshot,
      });
    } else if (incomingData && incomingData !== session.incomingData) {
      setSession({
        ...session,
        incomingData,
        snapshot: { ...session.snapshot, actionData: incomingData, scrollTop: 0 },
      });
    }

    useEffect(() => {
      entries.set(session.key, {
        ...session.snapshot,
        scrollTop: entries.get(session.key)?.scrollTop ?? session.snapshot.scrollTop,
      });
      if (entries.size > 16) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
    }, [session]);

    useBrowserLayoutEffect(() => {
      if (isReady && searchBodyRef.current) {
        searchBodyRef.current.scrollTop = entries.get(session.key)?.scrollTop
          ?? session.snapshot.scrollTop;
      }
    }, [isReady, session.key, session.snapshot.flow.isOpen]);

    const dispatchSearchFlow = useCallback((action: SearchModalFlowAction) => {
      setSession((current) => ({
        ...current,
        snapshot: {
          ...current.snapshot,
          flow: searchModalFlowReducer(current.snapshot.flow, action),
        },
      }));
    }, []);

    const rememberSearchScroll = useCallback(() => {
      const entry = entries.get(key);
      if (entry && searchBodyRef.current) entry.scrollTop = searchBodyRef.current.scrollTop;
    }, [key]);

    return {
      actionData: session.snapshot.actionData,
      dispatchSearchFlow,
      rememberSearchScroll,
      searchBodyRef,
      searchFlow: session.snapshot.flow,
    };
  };

  function initialSnapshot(): SearchSnapshot<T> {
    return { flow: initialSearchModalFlowState, scrollTop: 0 };
  }
}

export const useScriptureSearchHistory = createSearchHistory<SearchActionData>();
export const useFathersSearchHistory = createSearchHistory<ChurchFathersActionData>();
