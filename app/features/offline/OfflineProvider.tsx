import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";

type OfflineContextValue = {
  isOffline: boolean;
};

const OfflineContext = createContext<OfflineContextValue>({ isOffline: false });

export function OfflineProvider({ children }: { children: ReactNode }) {
  // Keep the server and the browser's first render identical. Reachability is
  // established immediately after hydration, including on an offline startup.
  const [isOffline, setIsOffline] = useState(false);
  const value = useMemo(() => ({ isOffline }), [isOffline]);

  useEffect(() => {
    const checkReachability = async () => {
      if (!navigator.onLine) {
        setIsOffline(true);
        return;
      }

      try {
        const response = await fetch("/?offline-health=1", {
          cache: "no-store",
          method: "HEAD"
        });
        setIsOffline(!response.ok);
      } catch {
        setIsOffline(true);
      }
    };
    const markOnline = () => void checkReachability();
    const markOffline = () => setIsOffline(true);
    const onServiceWorkerMessage = (event: MessageEvent<unknown>) => {
      const message = event.data;

      if (!message || typeof message !== "object") {
        return;
      }

      const typedMessage = message as { source?: unknown; type?: unknown };

      if (typedMessage.source !== "cross-canon") {
        return;
      }

      if (typedMessage.type === "offline") {
        markOffline();
      }

      if (typedMessage.type === "online") {
        markOnline();
      }
    };

    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    navigator.serviceWorker?.addEventListener("message", onServiceWorkerMessage);
    void checkReachability();

    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
      navigator.serviceWorker?.removeEventListener("message", onServiceWorkerMessage);
    };
  }, []);

  return (
    <OfflineContext.Provider value={value}>
      {children}
      {isOffline ? <div className="offline-indicator" role="status">Offline</div> : null}
    </OfflineContext.Provider>
  );
}

export function useOfflineStatus() {
  return useContext(OfflineContext);
}
