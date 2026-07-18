// Typed accessor for the runtime configuration injected by /config.js.
//
// In deployed environments the Cloudflare Worker serves /config.js per env (worker/index.ts);
// in `pnpm dev` a Vite middleware serves it (vite.config.ts). The app reads config from here —
// never from build-time `import.meta.env` — so a single built artifact promotes across envs.

export type AppEnv = "dev" | "uat" | "prod" | "local"

export interface AppConfig {
  env: AppEnv
  apiBaseUrl: string
  /** Exchange stream base (wss://…) — consumed by the order-book sync layer. */
  wsUrl: string
  /** Exchange REST base (https://…) — the depth-snapshot endpoint's origin. */
  binanceRestUrl: string
}

declare global {
  interface Window {
    __APP_CONFIG__?: AppConfig
  }
}

// Used only if /config.js hasn't populated the global (e.g. a unit test with no DOM bootstrap).
// `pnpm dev` and every deployed env always provide it.
const fallback: AppConfig = {
  env: "local",
  apiBaseUrl: "",
  wsUrl: "",
  binanceRestUrl: "",
}

export function getConfig(): AppConfig {
  return window.__APP_CONFIG__ ?? fallback
}
