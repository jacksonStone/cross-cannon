import type { MetaFunction } from "@remix-run/node";
import { Link, useSearchParams } from "@remix-run/react";
import { useState } from "react";
import { useAccount } from "~/features/account/AccountProvider";
import { authClient } from "~/features/account/auth-client";
import { CORPORA, progressUrl, READER_PROGRESS } from "~/features/account/progress";
import { activateAccount, importGuestProgress, localProgress } from "~/features/account/progress-storage";
import { useProgressLabels } from "~/features/account/useProgressLabels";

export const meta: MetaFunction = () => [{ title: "Your account | Cross Canon" }, { name: "robots", content: "noindex" }];
export const headers = () => ({ "Cache-Control": "private, no-store", Vary: "Cookie" });

export default function AccountPage() {
  const account = useAccount();
  const [searchParams] = useSearchParams();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const locationLabel = useProgressLabels(account.progress);

  async function signIn() {
    setPending(true);
    setError("");
    try {
      const result = await authClient.signIn.social({
        provider: "google", callbackURL: "/account", errorCallbackURL: "/account?signin=failed",
      });
      if (result.error) throw new Error("Sign-in failed");
    } catch {
      setError("Google sign-in could not start. Please try again.");
      setPending(false);
    }
  }

  async function signOut() {
    setPending(true);
    setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error("Sign-out failed");
      activateAccount(null);
      window.location.assign("/account");
    } catch {
      setError("Could not sign out. Reconnect and try again.");
      setPending(false);
    }
  }

  return (
    <main className="account-page">
      <Link to="/" className="account-back" reloadDocument>← Back to reading</Link>
      <div className="account-brand">CROSS CANON</div>
      <h1>{account.user ? "Your reading, together." : "Pick up where you left off."}</h1>
      <p className="account-intro">Keep your place across devices. Reading is always available without an account.</p>

      <section className="account-card" aria-label="Your account" aria-busy={account.loading || pending}>
        {account.loading ? <p role="status">Checking sign-in…</p> : account.user ? <>
          <p className="account-kicker">SIGNED IN WITH GOOGLE</p>
          <h2>{account.user.name || "Your account"}</h2>
          <p className="account-email">{account.user.email}</p>
          <p role="status" className="account-status">{account.status}</p>
          <div className="account-progress-list">
            {CORPORA.map((corpus) => {
              const saved = account.progress[corpus];
              const local = localProgress(account.user!.id, corpus);
              return <div className="account-progress" key={corpus}>
                <h3>{READER_PROGRESS[corpus].label}</h3>
                {saved ? <>
                  <p className="account-location">{locationLabel(saved.location)}</p>
                  {local?.conflict ? <div className="account-conflict">
                    <p>This device and another device have different reading progress.</p>
                    <p>Other device: {locationLabel(local.conflict.location)}</p>
                    <div className="account-actions">
                      <button type="button" onClick={() => account.resolveConflict(corpus, "cloud")}>Use other device</button>
                      <button type="button" onClick={() => account.resolveConflict(corpus, "local")}>Keep this device</button>
                    </div>
                  </div> : <Link reloadDocument to={progressUrl(saved.location)}>Continue reading →</Link>}
                </> : <p>No saved place yet.</p>}
              </div>;
            })}
          </div>
          <details className="account-import" open={importing} onToggle={(event) => setImporting(event.currentTarget.open)}>
            <summary>Bring in reading progress from before sign-in</summary>
            <p>Use the places saved while reading without an account on this browser. If your account already has a saved place, you’ll choose which to keep.</p>
            <button type="button" onClick={() => {
              try {
                importGuestProgress(account.user!.id);
                account.sync();
                setImporting(false);
              } catch { setError("This browser could not save progress. Check its storage settings."); }
            }}>Bring in my progress</button>
          </details>
          <div className="account-actions">
            <button type="button" onClick={account.sync}>Sync now</button>
            <button type="button" disabled={pending} onClick={() => void signOut()}>Sign out</button>
          </div>
        </> : <>
          <h2>One account. Every device.</h2>
          <p>Sign in with the same Google account on your phone, tablet, or computer to sync your reading progress.</p>
          <button className="google-sign-in" type="button" disabled={pending || !account.configured}
            onClick={() => void signIn()}>
            {pending ? "Connecting to Google…" : "Continue with Google"}
          </button>
          <p className="account-fine-print">{account.configured
            ? "Google handles your sign-in. Cross Canon stores your reading progress."
            : "Google sign-in is not available yet. Your reading progress still saves on this device."}</p>
          {searchParams.get("signin") === "failed"
            ? <p role="alert">Sign-in wasn’t completed. You can try again.</p> : null}
        </>}
        {error ? <p role="alert">{error}</p> : null}
      </section>
    </main>
  );
}
