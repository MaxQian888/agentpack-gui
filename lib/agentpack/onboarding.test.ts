import type { NetworkProbeResult, RankedMirror, RankedProxy } from "./network/probe"
import {
  asAgentChoice,
  CORE_MCPS,
  needsProxyStep,
  networkAdoption,
  wizardSelection,
} from "./onboarding"
import { findMcp } from "./registry"

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
