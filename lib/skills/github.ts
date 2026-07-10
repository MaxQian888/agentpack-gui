/**
 * GitHub source parsing for direct skill installs. Accepts the source formats
 * the skills.sh CLI popularized: `owner/repo`, a github.com URL (± `.git`), and
 * `tree/<ref>[/<subpath>]` deep links. Download itself happens in Rust; this
 * builds the codeload tarball URL (`HEAD` resolves the default branch without a
 * GitHub API call).
 */
import type { RepoSkill } from "./types"

export interface RepoRef {
  owner: string
  repo: string
  /** Branch/tag/commit, or "HEAD" for the default branch. */
  ref: string
  /** Path inside the repo the user linked to ("" = whole repo). */
  subpath: string
}

const NAME = /^[A-Za-z0-9_.-]+$/

/** Parse a repo source string; null when it doesn't look like a GitHub repo. */
export function parseRepoSource(input: string): RepoRef | null {
  const raw = input.trim()
  if (!raw) return null

  // URL forms: https://github.com/owner/repo[.git][/tree/<ref>[/<subpath>]]
  const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\//i.exec(raw)
  if (url) {
    const rest = raw.slice(url[0].length).replace(/[?#].*$/, "")
    const segments = rest.split("/").filter(Boolean)
    if (segments.length < 2) return null
    const owner = segments[0]
    const repo = segments[1].replace(/\.git$/, "")
    if (!NAME.test(owner) || !NAME.test(repo)) return null
    if (segments[2] === "tree" && segments.length >= 4) {
      // Branch names containing "/" are a documented limitation: the first
      // segment after `tree` is taken as the ref.
      return { owner, repo, ref: segments[3], subpath: segments.slice(4).join("/") }
    }
    return { owner, repo, ref: "HEAD", subpath: "" }
  }

  // Shorthand: owner/repo
  const parts = raw.split("/")
  if (parts.length === 2 && NAME.test(parts[0]) && NAME.test(parts[1])) {
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, ""), ref: "HEAD", subpath: "" }
  }
  return null
}

/**
 * Codeload tarball URL for a repo ref. `mirrorPrefix` (e.g. `https://gh-proxy.com/`)
 * is prepended verbatim for users behind a GitHub-unfriendly network.
 */
export function tarballUrl(ref: RepoRef, mirrorPrefix?: string | null): string {
  const base = `https://codeload.github.com/${ref.owner}/${ref.repo}/tar.gz/${ref.ref}`
  const prefix = mirrorPrefix?.trim()
  if (!prefix) return base
  return prefix.endsWith("/") ? `${prefix}${base}` : `${prefix}/${base}`
}

/** Keep only skills under the subpath the user's deep link pointed at. */
export function filterBySubpath(skills: RepoSkill[], subpath: string): RepoSkill[] {
  const prefix = subpath.replace(/^\/+|\/+$/g, "")
  if (!prefix) return skills
  return skills.filter((s) => s.relPath === prefix || s.relPath.startsWith(`${prefix}/`))
}
