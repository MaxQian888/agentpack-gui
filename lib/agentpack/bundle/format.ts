import { parseConfig, redactPlan, sanitizeProxy } from "../config"
import { exportProviders, parseProviderBundle, type BundleEntry } from "../ccswitch/transfer"
import type { Provider } from "../ccswitch/types"
import { parseProfiles, type Profile } from "../profile"
import type { OS, Plan } from "../types"
import { en } from "@/lib/i18n/en"
import type { Messages } from "@/lib/i18n/types"
import type { AppSettings } from "@/lib/tauri/settings"
import { pickClaudeConfigSubset, redactFileText, type BundleFileKey } from "./secrets"

/**
 * A whole-machine backup: everything that makes one agentpack install differ
 * from a fresh one, in a single file. The v1 config (a bare `Plan`) only ever
 * described what the user *intended to install*; this also carries what actually
 * ended up on disk, which is what makes moving to a new machine work.
 *
 * Every part is optional and parsed independently — a bundle written by a build
 * that knew about one more part, or whose plan references a CLI this build has
 * dropped, still imports everything else.
 */
export const BUNDLE_VERSION = 2 as const

export interface Bundle {
  version: typeof BUNDLE_VERSION
  createdAt: number
  app: { version: string; os: OS }
  plan?: Plan
  profiles?: Profile[]
  providers?: BundleEntry[]
  files?: Partial<Record<BundleFileKey, string>>
  settings?: Partial<AppSettings>
  /** True when the writer opted into shipping credentials verbatim. */
  secrets?: boolean
}

export interface BundleSource {
  /** Stamped by the caller — this module stays clock-free so it can be tested. */
  createdAt: number
  app: { version: string; os: OS }
  plan?: Plan
  profiles?: Profile[]
  providers?: Provider[]
  /** Raw text already read from disk, keyed by `Paths` field name. */
  files?: Partial<Record<BundleFileKey, string>>
  settings?: AppSettings
}

/**
 * App settings worth carrying to another machine. An allowlist rather than a
 * denylist so a setting added later — which may well hold a credential — is not
 * exported by default just because nobody remembered to exclude it.
 *
 * Omitted on purpose: `skippedVersion`, `lastCheckAt`, `onboarded`,
 * `onboardingProgress` and `quickStartDismissed` describe this install's
 * history, not its configuration.
 */
export const EXPORTED_SETTINGS_KEYS = [
  "autoCheckUpdates",
  "ghMirrorPrefix",
  "skillRepoSources",
  "proxy",
  "summonShortcut",
  "monthlySubscriptionUsd",
  "providerBackend",
  "uiScale",
  "reduceMotion",
  "startupSection",
] as const satisfies readonly (keyof AppSettings)[]

function buildSettings(settings: AppSettings, includeSecrets: boolean): Partial<AppSettings> {
  const out: Partial<AppSettings> = {}
  for (const key of EXPORTED_SETTINGS_KEYS) {
    if (settings[key] === undefined) continue
    ;(out as Record<string, unknown>)[key] = settings[key]
  }
  const proxy = sanitizeProxy(settings.proxy ?? undefined)
  if (!proxy) delete out.proxy
  if (proxy) {
    out.proxy = includeSecrets
      ? proxy
      : { ...proxy, password: undefined, clientKeyPassphrase: undefined }
  }
  return out
}

function buildFiles(
  files: Partial<Record<BundleFileKey, string>>,
  includeSecrets: boolean
): Partial<Record<BundleFileKey, string>> {
  const out: Partial<Record<BundleFileKey, string>> = {}
  for (const [k, text] of Object.entries(files) as [BundleFileKey, string][]) {
    if (!text?.trim()) continue // file absent on this machine
    // ~/.claude.json is narrowed before redaction: most of it is session state
    // that neither needs redacting nor belongs in a portable backup.
    const source = k === "claudeConfig" ? pickClaudeConfigSubset(text) : text
    if (source === null) continue
    if (includeSecrets) {
      out[k] = source
      continue
    }
    const redacted = redactFileText(k, source)
    // null means unparseable — excluded entirely rather than shipped unchecked.
    if (redacted !== null) out[k] = redacted
  }
  return out
}

export function buildBundle(src: BundleSource, opts: { includeSecrets: boolean }): Bundle {
  const { includeSecrets } = opts
  const bundle: Bundle = {
    version: BUNDLE_VERSION,
    createdAt: src.createdAt,
    app: src.app,
    ...(includeSecrets ? { secrets: true } : {}),
  }
  if (src.plan) bundle.plan = includeSecrets ? src.plan : redactPlan(src.plan)
  if (src.profiles) {
    // A profile embeds a whole Plan, secrets and all — the easiest place in this
    // feature to leak a key by forgetting one level of nesting.
    bundle.profiles = includeSecrets
      ? src.profiles
      : src.profiles.map((p) => ({ ...p, plan: redactPlan(p.plan) }))
  }
  if (src.providers) {
    bundle.providers = (
      JSON.parse(exportProviders(src.providers, { includeTokens: includeSecrets })) as {
        providers: BundleEntry[]
      }
    ).providers
  }
  if (src.files) bundle.files = buildFiles(src.files, includeSecrets)
  if (src.settings) bundle.settings = buildSettings(src.settings, includeSecrets)
  return bundle
}

export function serializeBundle(bundle: Bundle): string {
  return JSON.stringify(bundle, null, 2) + "\n"
}

export type BundlePart = "plan" | "profiles" | "providers" | "files" | "settings"

export type BundleParse =
  | { ok: true; bundle: Bundle; skipped: BundlePart[]; legacy: boolean }
  | { ok: false; error: string }

const FILE_KEYS: readonly BundleFileKey[] = [
  "claudeSettings",
  "claudeConfig",
  "codexConfig",
  "opencodeConfig",
  "ccConnectConfig",
]

function parseSettings(raw: unknown): Partial<AppSettings> {
  if (!raw || typeof raw !== "object") return {}
  const src = raw as Record<string, unknown>
  const out: Partial<AppSettings> = {}
  for (const key of EXPORTED_SETTINGS_KEYS) {
    const v = src[key]
    if (v === undefined) continue
    if (key === "proxy") {
      const proxy = sanitizeProxy((v ?? undefined) as Plan["network"]["proxy"])
      if (proxy) out.proxy = proxy
      continue
    }
    if (key === "skillRepoSources") {
      if (!Array.isArray(v)) continue
      out.skillRepoSources = v.filter(
        (s): s is AppSettings["skillRepoSources"][number] =>
          !!s && typeof s === "object" && typeof (s as { url?: unknown }).url === "string"
      )
      continue
    }
    if (key === "providerBackend") {
      if (v === "native" || v === "ccswitch") out.providerBackend = v
      continue
    }
    ;(out as Record<string, unknown>)[key] = v
  }
  return out
}

/**
 * Read a bundle. Never throws: an import is the one place a file from another
 * machine reaches this code, so each part is parsed in isolation and a part that
 * fails is reported in `skipped` rather than taking the whole file down with it.
 */
export function parseBundle(json: string, messages: Messages = en): BundleParse {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(json) as Record<string, unknown>
  } catch {
    return { ok: false, error: messages.errors.invalidJson }
  }
  if (!data || typeof data !== "object") return { ok: false, error: messages.errors.notABundle }

  const version = data["version"]
  // A v1 file is a bare Plan. Handled explicitly rather than by falling through,
  // and checked before the v2 path so a future format can be rejected by number
  // instead of being misread as a plan.
  if (version === undefined || version === 1) {
    try {
      const plan = parseConfig(json, messages)
      return {
        ok: true,
        legacy: true,
        skipped: [],
        bundle: {
          version: BUNDLE_VERSION,
          createdAt: 0,
          app: { version: "", os: plan.os },
          plan,
        },
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : messages.errors.notABundle }
    }
  }
  if (typeof version !== "number") return { ok: false, error: messages.errors.notABundle }
  if (version > BUNDLE_VERSION) {
    return { ok: false, error: messages.errors.bundleTooNew(String(version)) }
  }

  const app = data["app"] as Bundle["app"] | undefined
  const bundle: Bundle = {
    version: BUNDLE_VERSION,
    createdAt: typeof data["createdAt"] === "number" ? data["createdAt"] : 0,
    app: {
      version: typeof app?.version === "string" ? app.version : "",
      os: app?.os === "win" || app?.os === "mac" || app?.os === "linux" ? app.os : "mac",
    },
    ...(data["secrets"] === true ? { secrets: true } : {}),
  }
  const skipped: BundlePart[] = []
  const part = (name: BundlePart, run: () => void) => {
    try {
      run()
    } catch {
      skipped.push(name)
    }
  }

  if (data["plan"] !== undefined) {
    // Routed through parseConfig for the full os / cli / method / skill / mcp
    // validation rather than re-implementing any of it here.
    part("plan", () => {
      bundle.plan = parseConfig(JSON.stringify(data["plan"]), messages)
    })
  }
  if (data["profiles"] !== undefined) {
    part("profiles", () => {
      bundle.profiles = parseProfiles(JSON.stringify({ profiles: data["profiles"] })).profiles
    })
  }
  if (data["providers"] !== undefined) {
    part("providers", () => {
      bundle.providers = parseProviderBundle(JSON.stringify({ providers: data["providers"] }))
    })
  }
  if (data["files"] !== undefined) {
    part("files", () => {
      const raw = data["files"]
      if (!raw || typeof raw !== "object") throw new Error("files")
      const src = raw as Record<string, unknown>
      const files: Partial<Record<BundleFileKey, string>> = {}
      for (const k of FILE_KEYS) if (typeof src[k] === "string") files[k] = src[k]
      bundle.files = files
    })
  }
  if (data["settings"] !== undefined) {
    part("settings", () => {
      bundle.settings = parseSettings(data["settings"])
    })
  }

  return { ok: true, bundle, skipped, legacy: false }
}
