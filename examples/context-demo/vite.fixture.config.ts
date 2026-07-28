import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

const fixtureHtml = fileURLToPath(new URL("./fixture/max.html", import.meta.url))

/**
 * Cross-origin Max *fixture* server. Serves only the fixture iframe for `/max*`
 * on `127.0.0.1:48715` — a genuinely different origin from the host app on
 * `localhost:48714`, so the embed's real cross-origin `postMessage` path (exact
 * origin + source checks, referrer-derived parent origin) is exercised end to end.
 *
 *   pnpm --filter @voyant-travel/max-context-demo dev:fixture      # 127.0.0.1:48715
 *   VITE_EMBED_ORIGIN=http://127.0.0.1:48715 \
 *     pnpm --filter @voyant-travel/max-context-demo dev:host-xorigin  # localhost:48714
 */
function maxFixture() {
  return {
    name: "max-fixture",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || "").split("?")[0]
        if (url === "/max" || url.startsWith("/max/")) {
          res.setHeader("Content-Type", "text/html")
          res.end(readFileSync(fixtureHtml, "utf8"))
          return
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [maxFixture()],
  server: { port: 48715, strictPort: true, host: true },
})
