import type { DiscoveryResult, ProxyCandidate } from "./discovery"
import type { BrewMirror, MirrorPreset } from "./mirrors"
import {
  isDefaultMirror,
  pickMirror,
  probeNetwork,
  rankMirrors,
  rankProxies,
  type CheckFn,
  type CheckResult,
} from "./probe"

const ok = (latencyMs: number): CheckResult => ({ ok: true, status: 200, latencyMs, reason: "ok" })
const fail = (reason = "timeout"): CheckResult => ({ ok: false, reason })

/**
 * A check driven by a lookup table keyed `"<proxy|direct> <url>"`, so a test
 * states exactly which route reaches which endpoint. Anything unlisted fails.
 */
function fakeCheck(table: Record<string, CheckResult>, log?: string[]): CheckFn {
  return async (proxyUrl, testUrl) => {
    const key = `${proxyUrl ?? "direct"} ${testUrl}`
    log?.push(key)
    return table[key] ?? fail()
  }
}

const candidate = (url: string, source: ProxyCandidate["source"] = "port"): ProxyCandidate => ({
  id: `${source}:${url}`,
  source,
  url,
  detail: url,
})

const preset = (id: string, url: string | null): MirrorPreset => ({
  id,
  label: id,
  url,
  probeUrl: `https://probe.test/${id}`,
})

describe("rankProxies", () => {
  it("puts reachable candidates first, fastest first", async () => {
    const slow = candidate("http://127.0.0.1:1")
    const fast = candidate("http://127.0.0.1:2")
    const dead = candidate("http://127.0.0.1:3")
    const check = fakeCheck({
      "http://127.0.0.1:1 https://api.anthropic.com/v1/models": ok(400),
      "http://127.0.0.1:2 https://api.anthropic.com/v1/models": ok(50),
    })

    const ranked = await rankProxies([slow, dead, fast], check)

    expect(ranked.map((r) => r.url)).toEqual([fast.url, slow.url, dead.url])
    expect(ranked[2].result?.ok).toBe(false)
  })

  it("keeps a candidate whose probe threw, marked as unmeasured", async () => {
    const check: CheckFn = async () => {
      throw new Error("ipc died")
    }
    const ranked = await rankProxies([candidate("http://127.0.0.1:7890")], check)
    expect(ranked).toHaveLength(1)
    expect(ranked[0].result).toBeNull()
  })

  it("returns an empty list when nothing was discovered", async () => {
    expect(await rankProxies([], fakeCheck({}))).toEqual([])
  })
})

describe("rankMirrors", () => {
  it("probes each preset's own probeUrl and sorts by latency", async () => {
    const presets = [
      preset("official", null),
      preset("mirror-a", "https://a"),
      preset("mirror-b", "https://b"),
    ]
    const check = fakeCheck({
      "direct https://probe.test/official": ok(900),
      "direct https://probe.test/mirror-a": ok(30),
      "direct https://probe.test/mirror-b": ok(120),
    })

    const ranked = await rankMirrors(presets, check)

    expect(ranked.map((r) => r.preset.id)).toEqual(["mirror-a", "mirror-b", "official"])
  })

  it("routes every probe through the given proxy", async () => {
    const log: string[] = []
    const check = fakeCheck({ "http://p:1 https://probe.test/official": ok(10) }, log)

    await rankMirrors([preset("official", null)], check, "http://p:1")

    expect(log).toEqual(["http://p:1 https://probe.test/official"])
  })

  it("preserves the catalog order when every mirror is unreachable", async () => {
    const presets = [preset("official", null), preset("mirror-a", "https://a")]
    const ranked = await rankMirrors(presets, fakeCheck({}))
    // Stable sort keeps the default first, so a total outage never produces a
    // recommendation to switch away from the default.
    expect(ranked.map((r) => r.preset.id)).toEqual(["official", "mirror-a"])
  })
})

describe("pickMirror", () => {
  const ranked = (entries: [string, string | null, CheckResult | null][]) =>
    entries.map(([id, url, result]) => ({ preset: preset(id, url), result }))

  it("repair mode takes the fastest reachable mirror, default or not", () => {
    const list = ranked([
      ["mirror-a", "https://a", ok(20)],
      ["official", null, ok(30)],
    ])
    expect(pickMirror(list, "repair", isDefaultMirror)?.preset.id).toBe("mirror-a")
  })

  it("suggest mode keeps a working default even when a mirror is somewhat faster", () => {
    const list = ranked([
      ["mirror-a", "https://a", ok(100)],
      ["official", null, ok(200)],
    ])
    // 2x is not enough to justify moving a user off the official registry.
    expect(pickMirror(list, "suggest", isDefaultMirror)?.preset.id).toBe("official")
  })

  it("suggest mode switches when the default is dramatically slower", () => {
    const list = ranked([
      ["mirror-a", "https://a", ok(50)],
      ["official", null, ok(1000)],
    ])
    expect(pickMirror(list, "suggest", isDefaultMirror)?.preset.id).toBe("mirror-a")
  })

  it("suggest mode switches when the default is unreachable", () => {
    const list = ranked([
      ["mirror-a", "https://a", ok(80)],
      ["official", null, fail()],
    ])
    expect(pickMirror(list, "suggest", isDefaultMirror)?.preset.id).toBe("mirror-a")
  })

  it("returns undefined when nothing is reachable, rather than inventing one", () => {
    const list = ranked([
      ["official", null, fail()],
      ["mirror-a", "https://a", null],
    ])
    expect(pickMirror(list, "repair", isDefaultMirror)).toBeUndefined()
    expect(pickMirror(list, "suggest", isDefaultMirror)).toBeUndefined()
  })
})

describe("probeNetwork", () => {
  const discovery = (candidates: ProxyCandidate[]): DiscoveryResult => ({
    candidates,
    pacUrl: null,
    noProxy: null,
  })
  const presets = { npmPresets: [preset("official", null)], ghPresets: [preset("gh", null)] }
  const single = {
    ...presets,
    pypiPresets: [preset("pypi", null)],
    brewPresets: [
      {
        id: "brew",
        label: "brew",
        apiDomain: null,
        bottleDomain: null,
        probeUrl: "https://probe.test/brew",
      } satisfies BrewMirror,
    ],
  }

  it("probes mirrors directly when the direct route already works", async () => {
    const log: string[] = []
    const check = fakeCheck(
      {
        "direct https://api.anthropic.com/v1/models": ok(40),
        "http://127.0.0.1:7890 https://api.anthropic.com/v1/models": ok(20),
        "direct https://probe.test/official": ok(15),
        "direct https://probe.test/gh": ok(15),
        "direct https://probe.test/pypi": ok(15),
        "direct https://probe.test/brew": ok(15),
      },
      log
    )

    const result = await probeNetwork(discovery([candidate("http://127.0.0.1:7890")]), {
      check,
      ...single,
    })

    expect(result.directOk).toBe(true)
    expect(result.bestProxy?.url).toBe("http://127.0.0.1:7890")
    // Direct works, so nothing is tunnelled needlessly.
    expect(log.filter((k) => k.startsWith("http://127.0.0.1:7890"))).toEqual([
      "http://127.0.0.1:7890 https://api.anthropic.com/v1/models",
    ])
    expect(result.npm[0].result?.ok).toBe(true)
  })

  it("routes mirror probes through the best proxy when direct is blocked", async () => {
    const log: string[] = []
    const proxy = "http://127.0.0.1:7890"
    const check = fakeCheck(
      {
        [`${proxy} https://api.anthropic.com/v1/models`]: ok(60),
        [`${proxy} https://probe.test/official`]: ok(70),
        [`${proxy} https://probe.test/gh`]: ok(70),
        [`${proxy} https://probe.test/pypi`]: ok(70),
        [`${proxy} https://probe.test/brew`]: ok(70),
      },
      log
    )

    const result = await probeNetwork(discovery([candidate(proxy)]), { check, ...single })

    expect(result.directOk).toBe(false)
    // Every mirror probe went through the proxy — probing them direct would
    // have marked all of them dead and recommended something unusable.
    expect(log.filter((k) => k.startsWith("direct"))).toEqual([
      "direct https://api.anthropic.com/v1/models",
    ])
    expect(result.npm[0].result?.ok).toBe(true)
    expect(result.brew[0].result?.ok).toBe(true)
  })

  it("reports a fully offline machine without a proxy recommendation", async () => {
    const result = await probeNetwork(discovery([candidate("http://127.0.0.1:7890")]), {
      check: fakeCheck({}),
      ...single,
    })

    expect(result.directOk).toBe(false)
    expect(result.bestProxy).toBeNull()
    expect(result.npm.every((m) => !m.result?.ok)).toBe(true)
  })

  it("carries the PAC note through from discovery", async () => {
    const result = await probeNetwork(
      { candidates: [], pacUrl: "http://wpad/proxy.pac", noProxy: null },
      { check: fakeCheck({}), ...single }
    )
    expect(result.pacUrl).toBe("http://wpad/proxy.pac")
  })
})
