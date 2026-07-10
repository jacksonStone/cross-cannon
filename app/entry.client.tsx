import { RemixBrowser } from "@remix-run/react";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";

if ("scrollRestoration" in window.history) {
  window.history.scrollRestoration = "manual";
}

if ("serviceWorker" in navigator) {
  const releaseAsset = [
    ...document.querySelectorAll<HTMLLinkElement>("link[rel='modulepreload']"),
  ].find((link) => link.href.includes("/assets/manifest-"));
  const releaseId = releaseAsset
    ? new URL(releaseAsset.href).pathname.split("/").at(-1) ?? "current"
    : "current";

  void navigator.serviceWorker
    .register(`/cross-canon-sw.js?release=${encodeURIComponent(releaseId)}`)
    .catch(() => undefined);
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <RemixBrowser />
    </StrictMode>
  );
});
