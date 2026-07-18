import type { ServerResponse } from "node:http"
import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { type Connect, type Plugin, defineConfig } from "vite"

// Owns the runtime-config mechanism that keeps env values out of the bundle (build-once-promote):
//   1. injects <script src="/config.js"> into index.html (both dev and build) so it's never
//      bundled — avoids Vite's non-module-script warning and keeps it in one place;
//   2. serves the local twins of every Worker route (worker/index.ts) in `pnpm dev` AND
//      `pnpm preview` — every Worker route needs a twin, or local serving diverges from
//      deployed behaviour. One handler, registered in both hooks, mirroring the Worker's
//      routing: /config.js → /api/health → unmatched /api/* 404 → static/SPA fallback.
function runtimeConfig(): Plugin {
  const devConfig = { env: "local", apiBaseUrl: "", wsUrl: "" }

  const sendNoStore = (
    res: ServerResponse,
    body: string,
    contentType: string,
    status = 200
  ): void => {
    // Node-side mirror of worker/no-store-response.ts (the ServerResponse↔Response platform
    // boundary rules out sharing the builder itself).
    res.statusCode = status
    res.setHeader("content-type", contentType)
    res.setHeader("cache-control", "no-store")
    res.setHeader("x-content-type-options", "nosniff")
    res.end(body)
  }

  const registerRuntimeRoutes = (middlewares: Connect.Server): void => {
    middlewares.use((req, res, next) => {
      // Match on the WHATWG-normalized pathname, mirroring the Worker's `new URL(request.url)`
      // (worker/index.ts): parsing `origin + req.url` collapses dot-segments (/api/../config.js →
      // /config.js) and strips the query, so local routing can't diverge from deployed. Don't
      // "simplify" back to req.url.split("?")[0] — that skips normalization. Exact-match, not
      // Connect's route-mounted use(path, fn) (which would prefix-match /api/health/* too).
      const pathname = new URL(`http://localhost${req.url ?? "/"}`).pathname
      if (pathname === "/config.js") {
        sendNoStore(
          res,
          `window.__APP_CONFIG__ = ${JSON.stringify(devConfig)}`,
          "application/javascript; charset=utf-8"
        )
        return
      }
      if (pathname === "/api/health") {
        sendNoStore(
          res,
          JSON.stringify({
            status: "ok",
            env: "local",
            now: new Date().toISOString(),
          }),
          "application/json; charset=utf-8"
        )
        return
      }
      if (pathname.startsWith("/api/")) {
        sendNoStore(
          res,
          JSON.stringify({ error: "not_found", path: pathname }),
          "application/json; charset=utf-8",
          404
        )
        return
      }
      next()
    })
  }

  return {
    name: "runtime-config",
    transformIndexHtml() {
      return [
        {
          tag: "script",
          attrs: { src: "/config.js" },
          injectTo: "head-prepend",
        },
      ]
    },
    // Both hooks run their middleware BEFORE Vite's internal ones (incl. the SPA fallback),
    // and neither affects the production build — deployed envs get these routes from the Worker.
    configureServer(server) {
      registerRuntimeRoutes(server.middlewares)
    },
    configurePreviewServer(server) {
      registerRuntimeRoutes(server.middlewares)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), runtimeConfig()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
