import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authConfigured, getAuth, getAccountsDatabase, PRIVATE_HEADERS, requireSameOrigin } from "~/features/account/auth.server";
import { accountJson } from "~/features/account/json-body.server";
import { approveNativeLogin, nativeSession, pollNativeLogin, revokeNativeSession, startNativeLogin } from "~/features/account/native-session.server";
import { getClientIp, rateLimit } from "~/lib/rate-limit.server";

export const loader = () => new Response(null, { status: 405, headers: PRIVATE_HEADERS });
export async function action({ request }: ActionFunctionArgs) {
  if (!authConfigured()) return json({ error: "Sign-in is unavailable." }, { status: 503, headers: PRIVATE_HEADERS });
  if (request.method !== "POST") return loader();
  // Native clients send no Origin. Browser callers must use our canonical origin.
  if (request.headers.has("Origin")) requireSameOrigin(request);
  const body = await accountJson(request);
  const database = getAccountsDatabase();
  if (body.operation === "start") {
    if (!rateLimit(`native-login:${getClientIp(request)}`).allowed) {
      return json({ error: "Please wait a minute and try again." }, { status: 429, headers: PRIVATE_HEADERS });
    }
    return json(startNativeLogin(database, body.platform), { headers: PRIVATE_HEADERS });
  }
  if (body.operation === "revoke") {
    if (!nativeSession(request)) return new Response(null, { status: 401, headers: PRIVATE_HEADERS });
    revokeNativeSession(request);
    return json({ revoked: true }, { headers: PRIVATE_HEADERS });
  }
  if (typeof body.id !== "string" || !/^[a-f0-9]{64}$/.test(body.id)) {
    return new Response(null, { status: 400, headers: PRIVATE_HEADERS });
  }
  if (body.operation === "approve") {
    requireSameOrigin(request);
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) return new Response(null, { status: 401, headers: PRIVATE_HEADERS });
    const ticket = approveNativeLogin(database, body.id, session.user.id);
    return json({ approved: Boolean(ticket), ticket }, { status: ticket ? 200 : 410, headers: PRIVATE_HEADERS });
  }
  if (body.operation === "poll" && typeof body.secret === "string" && /^[a-f0-9]{64}$/.test(body.secret)) {
    if (body.ticket !== undefined && (typeof body.ticket !== "string" || !/^[a-f0-9]{64}$/.test(body.ticket))) {
      return new Response(null, { status: 400, headers: PRIVATE_HEADERS });
    }
    const result = pollNativeLogin(database, body.id, body.secret, body.ticket as string | undefined);
    return json(result, { status: result.status === "slow_down" ? 429 : 200, headers: PRIVATE_HEADERS });
  }
  return new Response(null, { status: 400, headers: PRIVATE_HEADERS });
}
