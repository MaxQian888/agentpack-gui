import type { MoreTokenInstance, MoreTokenInstanceDraft } from "./types"

/**
 * The server address as Rust stores it (`normalize_base_url` in
 * `src-tauri/src/more_token.rs`): origin only, no trailing slash. Null for an
 * address Rust would refuse — a save with it fails on its own, so nothing about
 * it counts as a change.
 */
export function normalizeBaseUrl(input: string): string | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.username || url.password || url.search || url.hash) return null
  if (url.pathname !== "/" && url.pathname !== "") return null
  const host = url.hostname.toLowerCase()
  const loopback = host === "localhost" || /^127\./.test(host) || host === "[::1]"
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null
  return url.origin
}

/**
 * Whether saving `draft` over `instance` changes what its credential is bound
 * to. Rust deletes the stored credential when the address or the CA changes —
 * locally only, the server is never told — so the caller has to revoke first.
 * A new CA file counts as a change even if it turns out to hold the same
 * certificate: the fingerprint isn't known until Rust imports it, and asking
 * for a needless re-pair is the safe way to be wrong.
 */
export function bindingChanged(
  instance: MoreTokenInstance,
  draft: MoreTokenInstanceDraft
): boolean {
  const baseUrl = normalizeBaseUrl(draft.baseUrl)
  if (baseUrl !== null && baseUrl !== instance.baseUrl) return true
  // Rust applies a clear before an import, so a clear wins.
  if (draft.clearCustomCa) return instance.caFingerprint !== null
  return Boolean(draft.customCaPath?.trim())
}
