import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { authConfigured, getAuth, getAccountsDatabase, PRIVATE_HEADERS, requireSameOrigin } from "~/features/account/auth.server";
import { parseLocation } from "~/features/account/progress";
import { readProgress, saveProgress } from "~/features/account/progress.server";
import { nativeSession } from "~/features/account/native-session.server";
import { accountJson } from "~/features/account/json-body.server";

export async function loader({ request }: LoaderFunctionArgs) {
  if (!authConfigured()) return json({ configured: false, user: null, progress: {} }, { headers: PRIVATE_HEADERS });
  try {
    const native = request.headers.has("Authorization");
    const appUser = native ? nativeSession(request) : null;
    const { response: session, headers } = native
      ? { response: appUser ? { user: appUser } : null, headers: new Headers() }
      : await getAuth().api.getSession({ headers: request.headers, returnHeaders: true });
    if (native && !session) return json({ error: "Sign in again." }, { status: 401, headers: PRIVATE_HEADERS });
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
  if (!request.headers.has("Authorization") || request.headers.has("Origin")) requireSameOrigin(request);
  if (request.method !== "POST") return new Response(null, { status: 405, headers: PRIVATE_HEADERS });
  const appUser = request.headers.has("Authorization") ? nativeSession(request) : null;
  const session = request.headers.has("Authorization") ? (appUser ? { user: appUser } : null)
    : await getAuth().api.getSession({ headers: request.headers });
  if (!session) return json({ error: "Sign in to sync progress." }, { status: 401, headers: PRIVATE_HEADERS });
  let value;
  try { value = await accountJson(request); } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
  const location = parseLocation(value?.location);
  if (!location || typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 0) {
    return json({ error: "Invalid reader location." }, { status: 400, headers: PRIVATE_HEADERS });
  }
  const result = saveProgress(getAccountsDatabase(), session.user.id, location, value.revision);
  return json(result, { status: result.saved ? 200 : 409, headers: PRIVATE_HEADERS });
}
