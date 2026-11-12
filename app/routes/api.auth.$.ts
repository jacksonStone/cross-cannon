import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authConfigured, getAuth, PRIVATE_HEADERS, requireSameOrigin } from "~/features/account/auth.server";

async function handle(request: Request) {
  if (!authConfigured()) return new Response("Google sign-in is not configured.", { status: 503, headers: PRIVATE_HEADERS });
  try {
    if (request.method !== "GET" && request.method !== "HEAD") requireSameOrigin(request);
    const response = await getAuth().handler(request);
    for (const [key, value] of Object.entries(PRIVATE_HEADERS)) response.headers.set(key, value);
    return response;
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Account request failed", error);
    return new Response("Sign-in is temporarily unavailable.", { status: 503, headers: PRIVATE_HEADERS });
  }
}

export const loader = ({ request }: LoaderFunctionArgs) => handle(request);
export const action = ({ request }: ActionFunctionArgs) => handle(request);
