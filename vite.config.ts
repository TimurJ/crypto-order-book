import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { type Plugin, defineConfig } from "vite"

// Owns the runtime-config mechanism that keeps env values out of the bundle (build-once-promote):
//   1. injects <script src="/config.js"> into index.html (both dev and build) so it's never
//      bundled — avoids Vite's non-module-script warning and keeps it in one place;
//   2. in `pnpm dev` only, serves /config.js with local defaults, mirroring the Cloudflare
//      Worker that serves it per-env in deployed builds (worker/index.ts).
function runtimeConfig(): Plugin {
  const devConfig = { env: "local", apiBaseUrl: "", wsUrl: "" }
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
    // configureServer only runs in the dev server, so this never affects the production build.
    configureServer(server) {
      server.middlewares.use("/config.js", (_req, res) => {
        res.setHeader("content-type", "application/javascript; charset=utf-8")
        res.setHeader("cache-control", "no-store")
        res.end(`window.__APP_CONFIG__ = ${JSON.stringify(devConfig)}`)
      })
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
