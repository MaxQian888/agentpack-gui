import { en } from "@/lib/i18n/en"
import type { NetworkProbeResult, RankedMirror, RankedProxy } from "./network/probe"
import {
  appsFor,
  asAgentChoice,
  connectionComplete,
  connectionForm,
  CORE_MCPS,
  CUSTOM_RELAY,
  LOGIN_COMMAND,
  needsProxyStep,
  networkAdoption,
  OFFICIAL_CONNECTION,
  probeFormFor,
  providerSetupSteps,
  relayPresets,
  wizardSelection,
} from "./onboarding"
import { findMcp } from "./registry"
import { buildSettingsConfig } from "./ccswitch/provider"
import type { Provider } from "./ccswitch/types"
import type { Paths, StepDescriptor } from "./types"

const ok = (latencyMs: number) => ({ ok: true, status: 200, latencyMs, reason: "ok" })
const down = { ok: false, reason: "timeout" }

const mirror = (url: string | null, label: string, result: RankedMirror["result"]) => ({
  preset: { id: label, label, url, probeUrl: "x" },
  result,
})

const clash: RankedProxy = {
  id: "port:clash",
  source: "port",
  url: "http://127.0.0.1:7890",
  detail: "Clash",
  result: ok(60),
}

const healthy: NetworkProbeResult = {
  proxies: [],
  bestProxy: null,
  directOk: true,
  npm: [mirror(null, "npmjs", ok(80))],
  gh: [mirror(null, "github", ok(90))],
  pypi: [],
  brew: [],
  pacUrl: null,
}

/** Official npm and GitHub unreachable; a proxy and two mirrors answer. */
const blocked: NetworkProbeResult = {
  ...healthy,
  directOk: false,
  bestProxy: clash,
  proxies: [clash],
  npm: [mirror("https://registry.npmmirror.com", "npmmirror", ok(30)), mirror(null, "npmjs", down)],
  gh: [mirror("https://ghfast.top/", "ghfast", ok(40)), mirror(null, "github", down)],
}

describe("wizardSelection", () => {
  it("installs the one agent picked, plus the keyless core servers configured for it", () => {
    const sel = wizardSelection("codex", false)
    expect(sel.clis).toEqual(["codex"])
    expect(sel.skills).toEqual([])
    expect(sel.mcps.map((m) => m.id)).toEqual([...CORE_MCPS])
    expect(sel.mcps.every((m) => m.targets.join() === "codex")).toBe(true)
  })

  it("puts each desktop app right after its CLI when asked for", () => {
    expect(wizardSelection("both", true).clis).toEqual([
      "claude-code",
      "claude-desktop",
      "codex",
      "codex-app",
    ])
    expect(wizardSelection("both", true).mcps[0]!.targets).toEqual(["claude", "codex"])
  })

  it("asks for no API key: every first-run server works without an account", () => {
    for (const id of CORE_MCPS) expect(findMcp(id)?.keyEnv).toBeUndefined()
  })
})

it("narrows a stale persisted choice back to the default", () => {
  expect(asAgentChoice("codex")).toBe("codex")
  expect(asAgentChoice("gui")).toBe("claude-code")
  expect(asAgentChoice(undefined)).toBe("claude-code")
})

describe("needsProxyStep", () => {
  it("asks only when the direct route fails and a proxy works", () => {
    expect(needsProxyStep(blocked)).toBe(true)
    expect(needsProxyStep(healthy)).toBe(false)
    expect(needsProxyStep({ ...blocked, bestProxy: null })).toBe(false)
  })

  it("asks nothing before the probe has measured", () => {
    expect(needsProxyStep(null)).toBe(false)
  })
})

describe("networkAdoption", () => {
  it("adopts the proxy and both mirrors by default on a blocked network", () => {
    const got = networkAdoption(blocked, { proxy: true, mirrors: true })
    expect(got.proxy).toMatchObject({ mode: "manual", httpUrl: clash.url, httpsUrl: clash.url })
    expect(got.npmRegistry).toEqual({ url: "https://registry.npmmirror.com", label: "npmmirror" })
    expect(got.ghMirrorPrefix).toEqual({ url: "https://ghfast.top/", label: "ghfast" })
  })

  it("routes a SOCKS proxy through ALL_PROXY", () => {
    const socks = { ...clash, url: "socks5://127.0.0.1:7891" }
    const got = networkAdoption({ ...blocked, bestProxy: socks }, { proxy: true, mirrors: false })
    expect(got.proxy).toMatchObject({ allUrl: socks.url, httpUrl: undefined })
  })

  it("honours each opt-out on its own", () => {
    expect(networkAdoption(blocked, { proxy: false, mirrors: true }).proxy).toBeUndefined()
    const noMirrors = networkAdoption(blocked, { proxy: true, mirrors: false })
    expect(noMirrors.npmRegistry).toBeUndefined()
    expect(noMirrors.ghMirrorPrefix).toBeUndefined()
  })

  it("changes nothing on a healthy network, or before anything was measured", () => {
    expect(networkAdoption(healthy, { proxy: true, mirrors: true })).toEqual({})
    expect(networkAdoption(null, { proxy: true, mirrors: true })).toEqual({})
  })
})

describe("connecting an account", () => {
  const paths = {
    home: "/h",
    claudeSettings: "/h/.claude/settings.json",
    codexConfig: "/h/.codex/config.toml",
    opencodeConfig: "/h/.config/opencode/opencode.json",
  } as Paths
  let n = 0
  const newId = () => `id-${++n}`
  beforeEach(() => (n = 0))

  it("maps each choice to the apps whose accounts it needs", () => {
    expect(appsFor("claude-code")).toEqual(["claude"])
    expect(appsFor("codex")).toEqual(["codex"])
    expect(appsFor("both")).toEqual(["claude", "codex"])
  })

  it("writes no provider for an official sign-in", () => {
    expect(connectionForm("claude", OFFICIAL_CONNECTION)).toBeNull()
    expect(probeFormFor("claude", OFFICIAL_CONNECTION)).toBeNull()
    expect(connectionComplete(OFFICIAL_CONNECTION)).toBe(true)
  })

  it("decides the auth variable from the choice: an Anthropic key is ANTHROPIC_API_KEY", () => {
    const form = connectionForm("claude", { kind: "apiKey", baseUrl: "", token: " sk-ant " })!
    expect(form).toMatchObject({ claudeAuthKind: "api_key", baseUrl: "", token: "sk-ant" })
    expect(JSON.parse(buildSettingsConfig(form)).env).toEqual({ ANTHROPIC_API_KEY: "sk-ant" })
    // Tested against the vendor API, though the config carries no base URL.
    expect(probeFormFor("claude", { kind: "apiKey", baseUrl: "", token: "k" })?.baseUrl).toBe(
      "https://api.anthropic.com"
    )
  })

  it("routes a Codex key through config.toml, the only file its live sync writes", () => {
    const form = connectionForm("codex", { kind: "apiKey", baseUrl: "", token: "sk-oa" })!
    expect(form.baseUrl).toBe("https://api.openai.com/v1")
    expect(JSON.parse(buildSettingsConfig(form)).config).toContain("experimental_bearer_token")
  })

  it("names a relay after its preset, or its host, with the bearer token", () => {
    const [preset] = relayPresets("claude")
    expect(preset).toBeDefined()
    const fromPreset = connectionForm("claude", {
      kind: "relay",
      preset: preset!.key,
      baseUrl: "",
      token: "t",
    })!
    expect(fromPreset).toMatchObject({
      baseUrl: preset!.form.baseUrl,
      claudeAuthKind: "auth_token",
    })
    const custom = connectionForm("claude", {
      kind: "relay",
      preset: CUSTOM_RELAY,
      baseUrl: "https://relay.example.com/api",
      token: "t",
    })!
    expect(custom).toMatchObject({ name: "relay.example.com", claudeAuthKind: "auth_token" })
  })

  it("offers only presets that name an endpoint, for that app", () => {
    for (const app of ["claude", "codex"] as const) {
      expect(relayPresets(app).every((p) => p.form.app === app && !!p.form.baseUrl)).toBe(true)
    }
  })

  it("is complete once its fields are filled, whatever a test said", () => {
    expect(connectionComplete({ kind: "apiKey", baseUrl: "", token: "" })).toBe(false)
    expect(connectionComplete({ kind: "apiKey", baseUrl: "", token: "k" })).toBe(true)
    expect(connectionComplete({ kind: "relay", baseUrl: "", token: "k" })).toBe(false)
    expect(connectionComplete({ kind: "relay", baseUrl: "https://r", token: "k" })).toBe(true)
  })

  describe("providerSetupSteps", () => {
    const form = connectionForm("claude", { kind: "apiKey", baseUrl: "", token: "k" })!
    const ids = (steps: StepDescriptor[]) => steps.map((s) => s.id)

    it("adds the first row for an app, which becomes current by itself, then syncs", () => {
      const steps = providerSetupSteps([form], [], paths, en, "native", newId)
      expect(ids(steps)).toEqual(["provider-native-add-claude", "cc-sync-claude"])
      expect(steps[0]!.kind === "ccProvider" && steps[0]!.payload).toMatchObject({ id: "id-1" })
      expect(steps[1]!.dependsOn).toEqual(["provider-native-add-claude"])
    })

    it("makes a new row current in the same run when another one already is", () => {
      const other: Provider = {
        id: "old",
        app_type: "claude",
        name: "Old relay",
        settings_config: "{}",
        is_current: true,
      }
      const steps = providerSetupSteps([form], [other], paths, en, "native", newId)
      expect(ids(steps)).toEqual([
        "provider-native-add-claude",
        "provider-native-setCurrent-claude",
        "cc-sync-claude",
      ])
      // The id the add wrote is the id the switch names.
      expect(steps[1]!.kind === "ccProvider" && steps[1]!.payload).toMatchObject({ id: "id-1" })
      expect(steps[1]!.dependsOn).toEqual(["provider-native-add-claude"])
      expect(steps[2]!.dependsOn).toEqual(["provider-native-setCurrent-claude"])
    })

    it("doesn't store an identical row twice", () => {
      const stored: Provider = {
        id: "same",
        app_type: "claude",
        name: "Anthropic API",
        settings_config: buildSettingsConfig(form),
        is_current: false,
      }
      const switched = providerSetupSteps([form], [stored], paths, en, "native", newId)
      expect(ids(switched)).toEqual(["provider-native-setCurrent-claude", "cc-sync-claude"])
      const already = providerSetupSteps(
        [form],
        [{ ...stored, is_current: true }],
        paths,
        en,
        "native",
        newId
      )
      expect(already).toEqual([])
    })
  })

  it("names the same sign-in commands login.rs runs", () => {
    expect(LOGIN_COMMAND).toEqual({ claude: "claude", codex: "codex login" })
  })
})
