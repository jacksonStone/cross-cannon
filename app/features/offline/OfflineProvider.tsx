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
    let healthController: AbortController | undefined;
    let disposed = false;
    const markOnline = () => {
      // A delayed successful worker request cannot override device-offline state.
      if (!navigator.onLine) return;
      window.clearTimeout(offlineTimeout);
      offlineTimeout = undefined;
      setIsOffline(false);
    };
    const markOfflineAfterDebounce = () => {
      if (offlineTimeout !== undefined) return;
      offlineTimeout = window.setTimeout(() => {
        offlineTimeout = undefined;
        setIsOffline(true);
      }, OFFLINE_DEBOUNCE_MS);
    };
    const checkOrigin = async () => {
      if (!navigator.onLine) {
        markOfflineAfterDebounce();
        return;
      }
      healthController?.abort();
      healthController = new AbortController();
      const controller = healthController;
      const timeout = window.setTimeout(() => controller.abort(), 4000);
      try {
        // A HEAD cannot be satisfied by a cached navigation document. This also
        // detects origin outages when the device still has a network connection.
        const response = await fetch("/?offline-health=reader", {
          cache: "no-store", method: "HEAD", signal: controller.signal
        });
        if (!disposed && healthController === controller) {
          if (response.ok) markOnline();
          else markOfflineAfterDebounce();
        }
      } catch {
        if (!disposed && healthController === controller) markOfflineAfterDebounce();
      } finally {
        window.clearTimeout(timeout);
      }
    };
    const onWorkerMessage = (event: MessageEvent) => {
      if (event.data?.source !== "cross-canon") return;
      if (event.data.type === "offline") markOfflineAfterDebounce();
      if (event.data.type === "online") markOnline();
    };

    window.addEventListener("offline", markOfflineAfterDebounce);
    window.addEventListener("online", checkOrigin);
    navigator.serviceWorker?.addEventListener("message", onWorkerMessage);
    setHasInitializedOfflineDetection(true);
    void checkOrigin();

    return () => {
      disposed = true;
      healthController?.abort();
      window.clearTimeout(offlineTimeout);
      window.removeEventListener(
        "offline",
        markOfflineAfterDebounce
      );
      window.removeEventListener("online", checkOrigin);
      navigator.serviceWorker?.removeEventListener("message", onWorkerMessage);
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
