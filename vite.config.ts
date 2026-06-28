import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import dns from "node:dns";
import { fileURLToPath } from "node:url";

patchBrokenLocalhostDns();

export default defineConfig({
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./app", import.meta.url))
    }
  },
  plugins: [
    remix({
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true
      }
    })
  ],
  server: {
    host: "127.0.0.1",
    port: 3005
  }
});

function patchBrokenLocalhostDns() {
  const originalLookup = dns.promises.lookup.bind(dns.promises) as (
    hostname: string,
    ...args: unknown[]
  ) => Promise<unknown>;

  dns.promises.lookup = (async (hostname: string, ...args: unknown[]) => {
    try {
      return await originalLookup(hostname, ...args);
    } catch (error) {
      if (hostname === "localhost" && isDnsNotFoundError(error)) {
        return {
          address: "127.0.0.1",
          family: 4
        };
      }

      throw error;
    }
  }) as typeof dns.promises.lookup;
}

function isDnsNotFoundError(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "ENOTFOUND"
  );
}
