import { serializePlan } from "../config"
import type { Provider } from "../ccswitch/types"
import type { Profile } from "../profile"
import type { Plan } from "../types"
import type { AppSettings } from "@/lib/tauri/settings"
import { en } from "@/lib/i18n/en"
import { buildBundle, parseBundle, serializeBundle, type BundleSource } from "./format"

const MCP_KEY = "mcp-live-key"
const PROXY_PASSWORD = "proxy-live-pw"
const PROVIDER_TOKEN = "sk-provider-live"
const CLAUDE_TOKEN = "sk-settings-live"
const SETTINGS_PROXY_PASSWORD = "settings-live-pw"

const PLAN: Plan = {
  os: "mac",
  clis: ["claude-code"],
  skills: [{ id: "rust", targets: ["claude"] }],
  mcps: [{ id: "context7", targets: ["claude"] }],
  mcpKeys: { context7: MCP_KEY },
  network: {
    npmRegistry: "https://registry.npmmirror.com",
    proxy: { mode: "manual", targets: ["claude"], httpUrl: "http://p:1", password: PROXY_PASSWORD },
  },
}

const PROFILES: Profile[] = [{ id: "p1", name: "Work", createdAt: 1, plan: PLAN }]

const PROVIDERS: Provider[] = [
  {
    id: "prov1",
    app_type: "claude",
    name: "Gateway",
    settings_config: JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: PROVIDER_TOKEN } }),
    is_current: true,
  },
]

const SETTINGS: AppSettings = {
  autoCheckUpdates: true,
  skippedVersion: "9.9.9",
  lastCheckAt: 123,
  onboarded: true,
  onboardingProgress: null,
  quickStartDismissed: true,
  ghMirrorPrefix: "https://mirror/",
  skillRepoSources: [],
  proxy: {
    mode: "manual",
    targets: ["npm"],
    httpUrl: "http://p:1",
    password: SETTINGS_PROXY_PASSWORD,
  },
  summonShortcut: null,
  monthlySubscriptionUsd: 20,
  providerBackend: "native",
  uiScale: 100,
  reduceMotion: false,
  startupSection: null,
}

const FILES = {
  claudeSettings: JSON.stringify({ model: "opus", env: { ANTHROPIC_AUTH_TOKEN: CLAUDE_TOKEN } }),
  codexConfig: 'model = "gpt-5"\n',
}

const SOURCE: BundleSource = {
  createdAt: 1700000000000,
  app: { version: "1.2.3", os: "mac" },
  plan: PLAN,
  profiles: PROFILES,
  providers: PROVIDERS,
  files: FILES,
  settings: SETTINGS,
}

const ALL_SECRETS = [MCP_KEY, PROXY_PASSWORD, PROVIDER_TOKEN, CLAUDE_TOKEN, SETTINGS_PROXY_PASSWORD]

describe("buildBundle / parseBundle round-trip", () => {
  it("carries every selected part back out again", () => {
    const bundle = buildBundle(SOURCE, { includeSecrets: true })
    const parsed = parseBundle(serializeBundle(bundle))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.skipped).toEqual([])
    expect(parsed.legacy).toBe(false)
    expect(parsed.bundle.plan?.clis).toEqual(["claude-code"])
    expect(parsed.bundle.profiles?.map((p) => p.name)).toEqual(["Work"])
    expect(parsed.bundle.providers?.map((p) => p.name)).toEqual(["Gateway"])
    expect(Object.keys(parsed.bundle.files ?? {})).toEqual(["claudeSettings", "codexConfig"])
    expect(parsed.bundle.settings?.ghMirrorPrefix).toBe("https://mirror/")
    expect(parsed.bundle.settings?.providerBackend).toBe("native")
    expect(parsed.bundle.app).toEqual({ version: "1.2.3", os: "mac" })
    expect(parsed.bundle.createdAt).toBe(1700000000000)
  })

  it("omits only the parts the source left out", () => {
    const bundle = buildBundle(
      { createdAt: 0, app: { version: "1", os: "mac" }, plan: PLAN },
      { includeSecrets: false }
    )
    expect(bundle.profiles).toBeUndefined()
    expect(bundle.providers).toBeUndefined()
    expect(bundle.files).toBeUndefined()
    expect(bundle.settings).toBeUndefined()
  })
})

describe("secret handling", () => {
  it("ships no credential of any kind by default", () => {
    const text = serializeBundle(buildBundle(SOURCE, { includeSecrets: false }))
    for (const secret of ALL_SECRETS) expect(text).not.toContain(secret)
  })

  it("ships every credential when the writer asked for it", () => {
    const text = serializeBundle(buildBundle(SOURCE, { includeSecrets: true }))
    for (const secret of ALL_SECRETS) expect(text).toContain(secret)
  })

  it("redacts the plan nested inside a saved profile", () => {
    const bundle = buildBundle(SOURCE, { includeSecrets: false })
    expect(bundle.profiles![0].plan.mcpKeys).toEqual({})
    expect(bundle.profiles![0].plan.network.proxy?.password).toBeUndefined()
    // The non-secret half of the profile still travels.
    expect(bundle.profiles![0].plan.network.npmRegistry).toBe("https://registry.npmmirror.com")
  })

  it("records whether it carries secrets so the import side can warn", () => {
    expect(buildBundle(SOURCE, { includeSecrets: true }).secrets).toBe(true)
    expect(buildBundle(SOURCE, { includeSecrets: false }).secrets).toBeUndefined()
    const parsed = parseBundle(serializeBundle(buildBundle(SOURCE, { includeSecrets: true })))
    expect(parsed.ok && parsed.bundle.secrets).toBe(true)
  })
})

describe("files", () => {
  it("skips a file that is missing on this machine", () => {
    const bundle = buildBundle(
      { ...SOURCE, files: { claudeSettings: "", codexConfig: 'model = "x"\n' } },
      { includeSecrets: false }
    )
    expect(Object.keys(bundle.files!)).toEqual(["codexConfig"])
  })

  it("skips a file it cannot parse rather than shipping it unchecked", () => {
    const bundle = buildBundle(
      { ...SOURCE, files: { codexConfig: "not [ toml" } },
      { includeSecrets: false }
    )
    expect(bundle.files).toEqual({})
  })

  it("narrows ~/.claude.json to its mcpServers subtree", () => {
    const bundle = buildBundle(
      {
        ...SOURCE,
        files: {
          claudeConfig: JSON.stringify({
            mcpServers: { memory: { command: "npx" } },
            projects: { "/repo": { history: ["private prompt"] } },
          }),
        },
      },
      { includeSecrets: false }
    )
    expect(JSON.parse(bundle.files!.claudeConfig!)).toEqual({
      mcpServers: { memory: { command: "npx" } },
    })
  })
})

describe("settings allowlist", () => {
  it("never exports this install's own history", () => {
    const bundle = buildBundle(SOURCE, { includeSecrets: false })
    expect(bundle.settings).not.toHaveProperty("skippedVersion")
    expect(bundle.settings).not.toHaveProperty("lastCheckAt")
    expect(bundle.settings).not.toHaveProperty("onboarded")
    expect(bundle.settings).not.toHaveProperty("quickStartDismissed")
  })

  it("drops an unknown key arriving in a bundle", () => {
    const raw = JSON.stringify({
      version: 2,
      createdAt: 0,
      app: { version: "1", os: "mac" },
      settings: { ghMirrorPrefix: "https://m/", someFutureSecret: "leak" },
    })
    const parsed = parseBundle(raw)
    expect(parsed.ok && parsed.bundle.settings).toEqual({ ghMirrorPrefix: "https://m/" })
  })

  it("sanitizes an imported proxy block", () => {
    const raw = JSON.stringify({
      version: 2,
      createdAt: 0,
      app: { version: "1", os: "mac" },
      settings: { proxy: { mode: "wat", targets: ["claude", "evil"] } },
    })
    const parsed = parseBundle(raw)
    expect(parsed.ok && parsed.bundle.settings?.proxy).toMatchObject({
      mode: "off",
      targets: ["claude"],
    })
  })

  it("drops an invalid provider backend arriving in a bundle", () => {
    const raw = JSON.stringify({
      version: 2,
      createdAt: 0,
      app: { version: "1", os: "mac" },
      settings: { providerBackend: "unknown" },
    })
    const parsed = parseBundle(raw)
    expect(parsed.ok && parsed.bundle.settings).toEqual({})
  })
})

describe("resilience", () => {
  it("keeps the other parts when one of them is invalid", () => {
    const bundle = buildBundle(SOURCE, { includeSecrets: false })
    const broken = { ...bundle, plan: { ...bundle.plan, clis: ["nope"] } }
    const parsed = parseBundle(JSON.stringify(broken))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.skipped).toEqual(["plan"])
    expect(parsed.bundle.plan).toBeUndefined()
    expect(parsed.bundle.profiles).toHaveLength(1)
    expect(parsed.bundle.providers).toHaveLength(1)
  })

  it("rejects text that isn't JSON at all", () => {
    const parsed = parseBundle("{ not json")
    expect(parsed).toEqual({ ok: false, error: expect.stringMatching(/JSON/i) })
  })

  it("rejects a format from a newer agentpack instead of guessing", () => {
    const parsed = parseBundle(JSON.stringify({ version: 9, app: {} }))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain("9")
  })
})

describe("v1 compatibility", () => {
  it("imports a bare plan written by the old Save config button", () => {
    const parsed = parseBundle(serializePlan(PLAN))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.legacy).toBe(true)
    expect(parsed.bundle.plan?.clis).toEqual(["claude-code"])
    expect(parsed.bundle.plan?.skills).toEqual([{ id: "rust", targets: ["claude"] }])
    expect(parsed.bundle.profiles).toBeUndefined()
  })

  it("reports a broken v1 file the same way the old loader did", () => {
    const parsed = parseBundle(JSON.stringify({ version: 1, os: "solaris" }))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain("solaris")
  })
})

describe("edge cases on the way out", () => {
  it("leaves out a setting this install never stored instead of writing undefined", () => {
    const partial = { ghMirrorPrefix: "https://m/", proxy: null } as unknown as AppSettings
    const bundle = buildBundle({ ...SOURCE, settings: partial }, { includeSecrets: false })
    expect(bundle.settings).toEqual({ ghMirrorPrefix: "https://m/" })
    expect(bundle.settings).not.toHaveProperty("proxy")
  })

  it("drops a ~/.claude.json that declares no MCP servers, with or without secrets", () => {
    for (const includeSecrets of [true, false]) {
      const bundle = buildBundle(
        {
          ...SOURCE,
          files: { claudeConfig: JSON.stringify({ projects: { "/r": {} }, mcpServers: {} }) },
        },
        { includeSecrets }
      )
      expect(bundle.files).toEqual({})
    }
  })

  it("narrows ~/.claude.json even when secrets are included", () => {
    const bundle = buildBundle(
      {
        ...SOURCE,
        files: {
          claudeConfig: JSON.stringify({
            mcpServers: { memory: { command: "npx", env: { KEY: "k" } } },
            projects: { "/repo": { history: ["private prompt"] } },
          }),
        },
      },
      { includeSecrets: true }
    )
    expect(bundle.files!.claudeConfig).not.toContain("private prompt")
    expect(JSON.parse(bundle.files!.claudeConfig!).mcpServers.memory.env).toEqual({ KEY: "k" })
  })
})

describe("edge cases on the way in", () => {
  const v2 = (over: Record<string, unknown>) =>
    JSON.stringify({ version: 2, createdAt: 0, app: { version: "1", os: "mac" }, ...over })

  it.each(["null", "5", '"a string"', "true"])("rejects %s as not a bundle", (text) => {
    expect(parseBundle(text)).toEqual({ ok: false, error: en.errors.notABundle })
  })

  it("rejects a version that is not a number rather than reading it as a plan", () => {
    expect(parseBundle(JSON.stringify({ version: "2", plan: PLAN }))).toEqual({
      ok: false,
      error: en.errors.notABundle,
    })
  })

  it("defaults a missing or malformed header rather than trusting it", () => {
    const parsed = parseBundle(
      JSON.stringify({ version: 2, createdAt: "yesterday", app: { version: 3, os: "solaris" } })
    )
    expect(parsed.ok && parsed.bundle).toEqual({
      version: 2,
      createdAt: 0,
      app: { version: "", os: "mac" },
    })
    const noApp = parseBundle(JSON.stringify({ version: 2 }))
    expect(noApp.ok && noApp.bundle.app).toEqual({ version: "", os: "mac" })
  })

  it.each(["win", "linux"] as const)("keeps a %s origin", (os) => {
    const parsed = parseBundle(v2({ app: { version: "1", os } }))
    expect(parsed.ok && parsed.bundle.app.os).toBe(os)
  })

  it("only an explicit true marks a bundle as carrying secrets", () => {
    const parsed = parseBundle(v2({ secrets: "yes" }))
    expect(parsed.ok && parsed.bundle).not.toHaveProperty("secrets")
  })

  it("skips a files part that is not an object, and keeps only known string files", () => {
    const broken = parseBundle(v2({ files: "oops", settings: { uiScale: 110 } }))
    expect(broken.ok && broken.skipped).toEqual(["files"])
    expect(broken.ok && broken.bundle.settings).toEqual({ uiScale: 110 })

    const nulled = parseBundle(v2({ files: null }))
    expect(nulled.ok && nulled.skipped).toEqual(["files"])

    const mixed = parseBundle(
      v2({ files: { codexConfig: 'model = "x"\n', claudeSettings: 42, "../etc/passwd": "x" } })
    )
    expect(mixed.ok && mixed.bundle.files).toEqual({ codexConfig: 'model = "x"\n' })
  })

  it("reads a non-object settings part as no settings at all", () => {
    for (const settings of [null, "x", 3]) {
      const parsed = parseBundle(v2({ settings }))
      expect(parsed.ok && parsed.skipped).toEqual([])
      expect(parsed.ok && parsed.bundle.settings).toEqual({})
    }
  })

  it("drops a malformed skill-source list and malformed entries in a good one", () => {
    const bad = parseBundle(v2({ settings: { skillRepoSources: "github.com/a/b" } }))
    expect(bad.ok && bad.bundle.settings).toEqual({})

    const mixed = parseBundle(
      v2({
        settings: {
          skillRepoSources: [{ url: "https://github.com/a/b" }, null, "x", { url: 5 }, {}],
        },
      })
    )
    expect(mixed.ok && mixed.bundle.settings?.skillRepoSources).toEqual([
      { url: "https://github.com/a/b" },
    ])
  })

  it("drops an imported proxy that sanitizes to nothing", () => {
    const parsed = parseBundle(v2({ settings: { proxy: null, providerBackend: "ccswitch" } }))
    expect(parsed.ok && parsed.bundle.settings).toEqual({ providerBackend: "ccswitch" })
  })
})
