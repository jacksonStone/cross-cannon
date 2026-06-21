import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";

import { getClientIp, rateLimit } from "~/lib/rate-limit.server";
import { searchScripture } from "~/lib/search.server";

type ActionData = {
  error?: string;
  question?: string;
  results?: Array<{
    reference: string;
    text: string;
    type: "verse" | "chapter";
  }>;
  retryAfterSeconds?: number;
};

export async function action({ request }: ActionFunctionArgs) {
  const ip = getClientIp(request);
  const limit = rateLimit(ip);

  if (!limit.allowed) {
    return json<ActionData>(
      {
        error: "Rate limit reached. Try again in a moment.",
        retryAfterSeconds: limit.retryAfterSeconds
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(limit.retryAfterSeconds)
        }
      }
    );
  }

  const formData = await request.formData();
  const question = String(formData.get("question") ?? "").trim();

  if (question.length < 3) {
    return json<ActionData>(
      { error: "Enter a longer question." },
      { status: 400 }
    );
  }

  if (question.length > 500) {
    return json<ActionData>(
      { error: "Keep the question under 500 characters." },
      { status: 400 }
    );
  }

  const results = await searchScripture(question, 10);
  return json<ActionData>({ question, results });
}

export default function Index() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSearching = navigation.state === "submitting";

  return (
    <main className="page-shell">
      <header className="site-header">
        <div>
          <p className="eyebrow">Cross Cannon</p>
          <h1>Ask a question. Receive Scripture.</h1>
        </div>
      </header>

      <section className="search-band" aria-label="Scripture search">
        <Form method="post" className="search-form">
          <label htmlFor="question">Question</label>
          <div className="search-row">
            <textarea
              id="question"
              name="question"
              rows={4}
              minLength={3}
              maxLength={500}
              required
              placeholder="What does Scripture say about fear, patience, forgiveness, or wisdom?"
              defaultValue={actionData?.question ?? ""}
            />
            <button type="submit" disabled={isSearching}>
              {isSearching ? "Searching" : "Search"}
            </button>
          </div>
        </Form>
      </section>

      {actionData?.error ? (
        <p className="notice" role="alert">
          {actionData.error}
          {actionData.retryAfterSeconds
            ? ` ${actionData.retryAfterSeconds} seconds remaining.`
            : ""}
        </p>
      ) : null}

      <section className="results" aria-live="polite">
        {actionData?.results?.length ? (
          actionData.results.map((result, index) => (
            <article className="scripture-result" key={`${result.reference}-${index}`}>
              <div className="result-meta">
                <span>{result.reference}</span>
                <span>{result.type}</span>
              </div>
              <p>{result.text}</p>
            </article>
          ))
        ) : (
          <div className="empty-state">
            <p>Scripture results will appear here.</p>
          </div>
        )}
      </section>
    </main>
  );
}
