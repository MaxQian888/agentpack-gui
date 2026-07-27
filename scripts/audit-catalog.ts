/**
 * Weekly catalog staleness audit.
 *
 * Walks every npm package and remote URL the catalog depends on and checks it
 * against the live registry / origin. Exits non-zero with a Markdown report when
 * anything is gone or deprecated, so CI can open an issue.
 *
 * The catalog is hand-maintained, and upstream deprecations are silent: a
 * removed npm package still gets written into the user's agent config and only
 * fails later, inside their agent. This job is what makes that loud.
 *
 * Run locally: pnpm audit:catalog
 */

import {
  collectAuditTargets,
  describeHealth,
  isUnhealthy,
  isUrlBroken,
  parsePackageHealth,
  type AuditTarget,
  type NpmVersionManifest,
} from "../lib/agentpack/catalog-audit"

const NPM_REGISTRY = "https://registry.npmjs.org"
const TIMEOUT_MS = 20_000

interface Failure {
  target: AuditTarget
  reason: string
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function checkNpm(target: AuditTarget): Promise<Failure | null> {
  const url = `${NPM_REGISTRY}/${target.value.replace("/", "%2F")}/latest`
  const res = await fetchWithTimeout(url, { headers: { accept: "application/json" } })
  let body: NpmVersionManifest | null = null
  if (res.ok) {
    body = (await res.json().catch(() => null)) as NpmVersionManifest | null
  }
  const health = parsePackageHealth(target.value, res.status, body)
  console.log(`  ${isUnhealthy(health) ? "FAIL" : "ok  "} ${describeHealth(health)}`)
  return isUnhealthy(health) ? { target, reason: describeHealth(health) } : null
}

/**
 * PyPI's JSON API. A yanked release is still installable by exact pin but must
 * not be handed to `uvx`, which resolves the latest — so treat it as unhealthy.
 */
async function checkPypi(target: AuditTarget): Promise<Failure | null> {
  const res = await fetchWithTimeout(`https://pypi.org/pypi/${target.value}/json`, {
    headers: { accept: "application/json" },
  })
  if (res.status === 404) {
    const reason = `${target.value}: does not exist on PyPI (404)`
    console.log(`  FAIL ${reason}`)
    return { target, reason }
  }
  if (!res.ok) {
    console.log(`  warn ${target.value} → PyPI HTTP ${res.status} (inconclusive)`)
    return null
  }
  const body = (await res.json().catch(() => null)) as {
    info?: { version?: string; yanked?: boolean }
  } | null
  if (body?.info?.yanked) {
    const reason = `${target.value}: latest PyPI release is yanked`
    console.log(`  FAIL ${reason}`)
    return { target, reason }
  }
  console.log(`  ok   ${target.value}: ok (${body?.info?.version ?? "unknown"}) [pypi]`)
  return null
}

async function checkUrl(target: AuditTarget): Promise<Failure | null> {
  // GET, not HEAD: several installer origins answer HEAD with 405 even though
  // the script downloads fine. The body is discarded.
  const res = await fetchWithTimeout(target.value, { method: "GET", redirect: "follow" })
  const broken = isUrlBroken(res.status)
  console.log(`  ${broken ? "FAIL" : "ok  "} ${target.value} → ${res.status}`)
  return broken ? { target, reason: `${target.value} → HTTP ${res.status}` } : null
}

async function check(target: AuditTarget): Promise<Failure | null> {
  try {
    if (target.kind === "npm") return await checkNpm(target)
    if (target.kind === "pypi") return await checkPypi(target)
    return await checkUrl(target)
  } catch (err) {
    // A network error is inconclusive, not proof the catalog is wrong. Report it
    // so it is visible, but do not fail the run on it.
    console.log(`  warn ${target.value} → unreachable (${(err as Error).message})`)
    return null
  }
}

async function main() {
  const targets = collectAuditTargets()
  console.log(`Auditing ${targets.length} catalog targets\n`)

  const failures: Failure[] = []
  // Sequential on purpose: this runs weekly, and hammering npm in parallel
  // invites rate-limiting that would show up as false failures.
  for (const target of targets) {
    const failure = await check(target)
    if (failure) failures.push(failure)
  }

  if (failures.length === 0) {
    console.log(`\nAll ${targets.length} catalog targets are healthy.`)
    return
  }

  const report = [
    `The weekly catalog audit found ${failures.length} stale ${
      failures.length === 1 ? "entry" : "entries"
    }.`,
    "",
    "| Catalog entry | Problem |",
    "| --- | --- |",
    ...failures.map((f) => `| \`${f.target.source}\` | ${f.reason} |`),
    "",
    "Fix these in `lib/agentpack/registry.ts`. A package that no longer exists is",
    "written into the user's agent config anyway and fails silently at run time,",
    "so treat a 404 as user-facing breakage.",
  ].join("\n")

  console.error(`\n${report}`)
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) {
    const { appendFileSync } = await import("node:fs")
    appendFileSync(summary, `## Catalog audit\n\n${report}\n`)
  }
  process.exitCode = 1
}

void main()
