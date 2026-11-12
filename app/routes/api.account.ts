import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { authConfigured, getAuth, getAccountsDatabase, PRIVATE_HEADERS, requireSameOrigin } from "~/features/account/auth.server";
import { parseLocation } from "~/features/account/progress";
import { readProgress, saveProgress } from "~/features/account/progress.server";

export async function loader({ request }: LoaderFunctionArgs) {
  if (!authConfigured()) return json({ configured: false, user: null, progress: {} }, { headers: PRIVATE_HEADERS });
  try {
    const { response: session, headers } = await getAuth().api.getSession({ headers: request.headers, returnHeaders: true });
    for (const [key, value] of Object.entries(PRIVATE_HEADERS)) headers.set(key, value);
    return json({
      configured: true,
      user: session ? { id: session.user.id, name: session.user.name, email: session.user.email } : null,
      progress: session ? readProgress(getAccountsDatabase(), session.user.id) : {},
    }, { headers });
  } catch (error) {
    console.error("Account lookup failed", error);
    return json({ error: "Accounts are temporarily unavailable." }, { status: 503, headers: PRIVATE_HEADERS });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  if (!authConfigured()) return json({ error: "Sign-in is unavailable." }, { status: 503, headers: PRIVATE_HEADERS });
  requireSameOrigin(request);
  if (request.method !== "POST") return new Response(null, { status: 405, headers: PRIVATE_HEADERS });
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return json({ error: "Sign in to sync progress." }, { status: 401, headers: PRIVATE_HEADERS });
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
    return new Response(null, { status: 415, headers: PRIVATE_HEADERS });
  }
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let size = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        void reader.cancel();
        return new Response(null, { status: 413, headers: PRIVATE_HEADERS });
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  }
  let value;
  try { value = JSON.parse(body); } catch { return new Response(null, { status: 400, headers: PRIVATE_HEADERS }); }
  const location = parseLocation(value?.location);
  if (!location || !Number.isSafeInteger(value?.revision) || value.revision < 0) {
    return json({ error: "Invalid reader location." }, { status: 400, headers: PRIVATE_HEADERS });
  }
  const result = saveProgress(getAccountsDatabase(), session.user.id, location, value.revision);
  return json(result, { status: result.saved ? 200 : 409, headers: PRIVATE_HEADERS });
}
