import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const OFFLINE_DEBOUNCE_MS = 5_000;

type OfflineContextValue = {
  hasInitializedOfflineDetection: boolean;
  isOffline: boolean;
};

const OfflineContext = createContext<OfflineContextValue>({
  hasInitializedOfflineDetection: false,
  isOffline: false,
});

export function OfflineProvider({ children }: { children: ReactNode }) {
  // Keep the server and the browser's first render identical.
  const [isOffline, setIsOffline] = useState(false);
  const [hasInitializedOfflineDetection, setHasInitializedOfflineDetection] =
    useState(false);
  const value = useMemo(
    () => ({ hasInitializedOfflineDetection, isOffline }),
    [hasInitializedOfflineDetection, isOffline]
  );
  useEffect(() => {
    let offlineTimeout: number | undefined;
    const markOfflineAfterDebounce = () => {
      window.clearTimeout(offlineTimeout);
      offlineTimeout = window.setTimeout(() => {
        if (!navigator.onLine) {
          setIsOffline(true);
        }
      }, OFFLINE_DEBOUNCE_MS);
    };

    window.addEventListener("offline", markOfflineAfterDebounce);
    setHasInitializedOfflineDetection(true);

    if (!navigator.onLine) {
      markOfflineAfterDebounce();
    }

    return () => {
      window.clearTimeout(offlineTimeout);
      window.removeEventListener(
        "offline",
        markOfflineAfterDebounce
      );
    };
  }, []);

  return (
    <OfflineContext.Provider value={value}>
      {children}
      {isOffline ? (
        <div className="offline-indicator" role="status">
          Offline
        </div>
      ) : null}
    </OfflineContext.Provider>
  );
}

export function useOfflineStatus() {
  return useContext(OfflineContext);
}
