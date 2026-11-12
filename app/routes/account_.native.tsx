import { json, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { useState } from "react";
import { useAccount } from "~/features/account/AccountProvider";
import { authConfigured, getAccountsDatabase, PRIVATE_HEADERS } from "~/features/account/auth.server";
import { authClient } from "~/features/account/auth-client";
import { pendingNativeLogin } from "~/features/account/native-session.server";

export const meta: MetaFunction = () => [{ title: "Connect your app | Cross Canon" }, { name: "robots", content: "noindex" }];
export const headers = () => ({ ...PRIVATE_HEADERS, "Referrer-Policy": "no-referrer" });
export function loader({ request }: LoaderFunctionArgs) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const login = authConfigured() && /^[a-f0-9]{64}$/.test(id)
    ? pendingNativeLogin(getAccountsDatabase(), id) ?? null : null;
  return json({ login }, { headers: headers() });
}

export default function ConnectApp() {
  const { login } = useLoaderData<typeof loader>();
  const account = useAccount();
  const [pending, setPending] = useState(false);
  const [approved, setApproved] = useState(false);
  const [returnUrl, setReturnUrl] = useState("");
  const [error, setError] = useState("");
  async function signIn() {
    if (!login) return;
    setPending(true); setError("");
    try {
      const result = await authClient.signIn.social({ provider: "google",
        callbackURL: `/account/native?id=${login.id}`, errorCallbackURL: `/account/native?id=${login.id}` });
      if (result.error) throw new Error();
    } catch { setPending(false); setError("Could not start Google sign-in. Please try again."); }
  }
  async function approve() {
    setPending(true); setError("");
    try {
      const response = await fetch("/api/native-login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "approve", id: login!.id }) });
      if (!response.ok) throw new Error();
      const { ticket } = await response.json();
      if (typeof ticket !== "string" || !/^[a-f0-9]{64}$/.test(ticket)) throw new Error();
      const callback = `crosscanon://login-complete?request=${login!.id}&ticket=${ticket}`;
      setReturnUrl(callback);
      setApproved(true);
      window.location.assign(callback);
    } catch { setError("This connection expired or could not be approved. Start again in the app."); }
    setPending(false);
  }
  return <main className="account-page native-sign-in-page">
    <div className="account-brand">CROSS CANON</div>
    <h1>{approved ? "You’re ready to read." : "Sign in to Cross Canon."}</h1>
    <section className="account-card">
      {!login ? <><p>This connection has expired. Tap Continue with Google again in the app.</p><Link to="/account">Your account</Link></>
        : approved ? <><p>Return to the app to finish signing in and sync your reading progress.</p>
          <a className="google-sign-in" href={returnUrl}>Return to Cross Canon</a>
        </> : <>
          <h2>{login.label}</h2>
          {account.loading ? <p role="status">Checking sign-in…</p> : account.user ? <>
            <p>{account.user.email}</p>
            <p>Keep your reading progress in sync with this app.</p>
            <button type="button" className="google-sign-in" disabled={pending} onClick={() => void approve()}>Continue as {account.user.name || "your Google account"}</button>
            <Link to="/account" reloadDocument>Use a different account</Link>
          </> : <button type="button" className="google-sign-in" disabled={pending} onClick={() => void signIn()}>Continue with Google</button>}
        </>}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  </main>;
}
