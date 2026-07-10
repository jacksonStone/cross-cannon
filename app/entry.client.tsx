import { RemixBrowser } from "@remix-run/react";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";

if ("scrollRestoration" in window.history) {
  window.history.scrollRestoration = "manual";
}

if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/cross-canon-sw.js").catch(() => undefined);
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <RemixBrowser />
    </StrictMode>
  );
});
