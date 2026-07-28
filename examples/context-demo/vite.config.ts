import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const fixtureHtml = fileURLToPath(new URL("./fixture/max.html", import.meta.url))

/**
 * Serve the local Max *fixture* iframe for any `/max*` path. In production the
 * embed points at `https://agent-embed.voyant.travel`; here we point `embedOrigin`
 * at this same dev server and answer the iframe requests with a fixture that
 * speaks the real postMessage protocol (context bar + inspect/clear, layout
 * round trips, a pinned historical snapshot). Same-origin with the host, but the
 * strict source/session/tenant checks still apply.
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
  plugins: [react(), maxFixture()],
  // `host: true` binds all interfaces so the host is reachable as
  // `localhost:48714` while the fixture runs cross-origin on `127.0.0.1:48715`.
  server: { port: 48714, strictPort: true, host: true },
})
