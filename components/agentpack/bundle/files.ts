import { BUNDLE_FILE_KEYS, type BundleFileKey } from "@/lib/agentpack/bundle/secrets"
import type { Paths } from "@/lib/agentpack/types"
import { readTextFile } from "@/lib/tauri/commands"

/**
 * Read the config files a bundle can carry. A file that's missing or unreadable
 * comes back as "" rather than throwing — on any given machine most of these
 * won't exist, and that's not an error worth failing an export over.
 */
export async function readBundleFiles(
  paths: Paths,
  keys: readonly BundleFileKey[] = BUNDLE_FILE_KEYS
): Promise<Partial<Record<BundleFileKey, string>>> {
  const texts = await Promise.all(keys.map((k) => readTextFile(paths[k]).catch(() => "")))
  return Object.fromEntries(keys.map((k, i) => [k, texts[i]]))
}
