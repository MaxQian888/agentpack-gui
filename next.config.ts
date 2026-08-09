import type { NextConfig } from "next"

const isProd = process.env.NODE_ENV === "production"

const internalHost = process.env.TAURI_DEV_HOST || "localhost"
const internalPort = process.env.AGENTPACK_E2E_PORT || "3000"

// Enable static export for Tauri production builds.
// This makes `pnpm build` generate the `out/` directory that Tauri loads from `src-tauri/tauri.conf.json` (frontendDist: "../out").
const nextConfig: NextConfig = {
  output: "export",
  // Note: This feature is required to use the Next.js Image component in SSG mode.
  // See https://nextjs.org/docs/messages/export-image-api for different workarounds.
  images: {
    unoptimized: true,
  },
  // Configure assetPrefix or else the server won't properly resolve your assets.
  assetPrefix: isProd ? undefined : `http://${internalHost}:${internalPort}`,
  // The window is frameless, so its top-left corner belongs to the macOS
  // traffic lights — the dev indicator's default `bottom-left` is fine, but
  // pinning it keeps it from ever landing on top of them.
  devIndicators: { position: "bottom-right" },
}

export default nextConfig
