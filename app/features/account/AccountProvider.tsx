import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link } from "@remix-run/react";
import type { ReaderCorpus } from "../reader-position/reader-position";
import { CORPORA, type Progress, type SavedProgress } from "./progress";
import {
  ACCOUNT_STORAGE_KEY, PROGRESS_EVENT, activateAccount, activeAccount,
  enableProgressStorage, localProgress, reconcileProgress, sameLocation, writeLocalProgress,
} from "./progress-storage";

type User = { id: string; name: string; email: string };
type Account = {
  user: User | null; configured: boolean; loading: boolean;
  status: string; progress: Progress; conflicts: ReaderCorpus[];
  sync: () => void;
  resolveConflict: (corpus: ReaderCorpus, choice: "local" | "cloud") => void;
};
const AccountContext = createContext<Account | null>(null);
export function useAccount() {
  const account = useContext(AccountContext);
  if (!account) throw new Error("AccountProvider is required.");
  return account;
}

export function AccountLink() {
  const account = useContext(AccountContext);
  const label = account?.conflicts.length ? "Account: choose which reading progress to keep" : "Account and reading progress";
  return <Link aria-label={label} title={label} to="/account" className="context-button reader-icon-button account-trigger">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
    </svg>
    {account?.conflicts.length ? <span aria-hidden="true" className="account-conflict-dot" /> : null}
  </Link>;
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState({ user: null as User | null, configured: false, loading: true,
    status: "Checking sign-in…", progress: {} as Progress, conflicts: [] as ReaderCorpus[] });
  const [generation, setGeneration] = useState(0);
  const [sync, setSync] = useState<() => void>(() => () => undefined);

  useEffect(() => {
    let disposed = false;
    let busy = false;
    let initialized = false;
    let user: User | null = null;
    let timer: ReturnType<typeof setTimeout>;
    function publish(status: string) {
      if (disposed || !user) return;
      const progress: Progress = {};
      const conflicts: ReaderCorpus[] = [];
      for (const corpus of CORPORA) {
        const local = localProgress(user.id, corpus);
        if (local) progress[corpus] = local;
        if (local?.conflict) conflicts.push(corpus);
      }
      setState((current) => ({ ...current, user, progress, conflicts,
        status: conflicts.length ? "Choose which reading progress to keep." : status }));
    }
    async function synchronize() {
      if (disposed || busy) return;
      busy = true;
      try {
        const response = await fetch("/api/account", { cache: "no-store", signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error("Account lookup failed");
        const account: { configured: boolean; user: User | null; progress: Progress } = await response.json();
        if (disposed) return;
        user = account.user;
        const oldAccount = activeAccount();
        if (initialized && oldAccount !== (user?.id ?? null)) {
          activateAccount(user?.id ?? null);
          window.location.reload();
          return;
        }
        if (user) reconcileProgress(user.id, account.progress);
        activateAccount(user?.id ?? null);
        setState((current) => ({ ...current, user, configured: account.configured, loading: false,
          status: user ? "Progress is synced." : "Sign in to sync across devices." }));
        if (!initialized) {
          initialized = true;
          enableProgressStorage();
          setGeneration((current) => current + 1);
        }
        if (!user) return;
        const userId = user.id;
        let pending = false;
        for (const corpus of CORPORA) {
          const local = localProgress(userId, corpus);
          if (!local?.dirty || local.conflict) continue;
          const saved = await fetch("/api/account", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ location: local.location, revision: local.revision }),
            signal: AbortSignal.timeout(5000),
          });
          if (disposed || activeAccount() !== userId) return;
          if (saved.status !== 409 && !saved.ok) throw new Error("Progress save failed");
          const result: { saved: boolean; progress: SavedProgress | null } = await saved.json();
          const latest = localProgress(userId, corpus);
          if (!latest) continue;
          if (result.saved && result.progress) {
            const dirty = !sameLocation(latest.location, local.location);
            writeLocalProgress(userId, corpus, { ...latest, revision: result.progress.revision, dirty, conflict: undefined });
            pending ||= dirty;
          } else if (result.progress) {
            writeLocalProgress(userId, corpus, { ...latest, conflict: result.progress });
          } else {
            writeLocalProgress(userId, corpus, { ...latest, revision: 0, dirty: true, conflict: undefined });
            pending = true;
          }
        }
        publish(pending ? "Saving progress…" : "Progress is synced.");
        if (pending) timer = setTimeout(() => void synchronize(), 1200);
      } catch {
        if (!disposed) {
          setState((current) => ({ ...current, loading: false,
            status: "Reading progress stays on this device until we can reconnect." }));
          if (!initialized) {
            initialized = true;
            enableProgressStorage();
            setGeneration((current) => current + 1);
          }
        }
      } finally { busy = false; }
    }
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void synchronize(), 1200);
    };
    const refresh = () => void synchronize();
    const storage = (event: StorageEvent) => {
      if (event.key === ACCOUNT_STORAGE_KEY) window.location.reload();
      else if (event.key?.startsWith("cross-cannon:account:")) schedule();
    };
    setSync(() => refresh);
    window.addEventListener(PROGRESS_EVENT, schedule);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", storage);
    const interval = setInterval(refresh, 30_000);
    void synchronize();
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener(PROGRESS_EVENT, schedule);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", storage);
    };
  }, []);

  function resolveConflict(corpus: ReaderCorpus, choice: "local" | "cloud") {
    if (!state.user) return;
    const local = localProgress(state.user.id, corpus);
    if (!local?.conflict) return;
    writeLocalProgress(state.user.id, corpus, {
      location: choice === "cloud" ? local.conflict.location : local.location,
      revision: local.conflict.revision, dirty: choice === "local",
    });
    sync();
  }

  return <AccountContext.Provider value={{ ...state, sync, resolveConflict }}>
    <div key={generation} className="account-reader-shell">{children}</div>
  </AccountContext.Provider>;
}
