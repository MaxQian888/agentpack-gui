import {
  WELL_KNOWN_PROXY_PORTS,
  candidatesFromEnv,
  candidatesFromPorts,
  candidatesFromSystem,
  candidatesFromTools,
  dedupeCandidates,
  discoverProxies,
  type DiscoveryProbes,
  type ProxyEnvSnapshot,
  type SystemProxySnapshot,
  type ToolProxySnapshot,
} from "./discovery"

const env = (patch: Partial<ProxyEnvSnapshot> = {}): ProxyEnvSnapshot => ({
  httpProxy: null,
  httpsProxy: null,
  allProxy: null,
  noProxy: null,
  ...patch,
})

const system = (patch: Partial<SystemProxySnapshot> = {}): SystemProxySnapshot => ({
  entries: [],
  pacUrl: null,
  bypass: [],
  ...patch,
})

const tools = (patch: Partial<ToolProxySnapshot> = {}): ToolProxySnapshot => ({
  npmProxy: null,
  npmHttpsProxy: null,
  npmNoProxy: null,
  npmRegistry: null,
  gitHttpProxy: null,
  gitHttpsProxy: null,
  ...patch,
})

const probes = (over: Partial<DiscoveryProbes> = {}): DiscoveryProbes => ({
  envSnapshot: async () => env(),
  systemSnapshot: async () => system(),
  toolSnapshot: async () => tools(),
  probePort: async () => false,
  ...over,
})

describe("per-source extraction", () => {
  it("reads env vars and skips unusable values", () => {
    const list = candidatesFromEnv(
      env({ httpsProxy: "127.0.0.1:7890", httpProxy: "  ", allProxy: "socks5://127.0.0.1:1080" })
    )
    expect(list).toEqual([
      { id: "env:HTTPS_PROXY", source: "env", url: "http://127.0.0.1:7890", detail: "HTTPS_PROXY" },
      { id: "env:ALL_PROXY", source: "env", url: "socks5://127.0.0.1:1080", detail: "ALL_PROXY" },
    ])
  })

  it("maps the OS panel's socks entry to a socks5 URL", () => {
    const list = candidatesFromSystem(
      system({
        entries: [
          { scheme: "https", host: "10.0.0.1", port: 8080 },
          { scheme: "socks", host: "10.0.0.1", port: 1080 },
        ],
      })
    )
    expect(list.map((c) => c.url)).toEqual(["https://10.0.0.1:8080", "socks5://10.0.0.1:1080"])
  })

  it("reads npm and git config", () => {
    const list = candidatesFromTools(
      tools({ npmProxy: "http://npm:1", gitHttpProxy: "http://git:2" })
    )
    expect(list).toEqual([
      { id: "npm:proxy", source: "npm", url: "http://npm:1", detail: "proxy" },
      { id: "git:http.proxy", source: "git", url: "http://git:2", detail: "http.proxy" },
    ])
  })

  it("labels open ports with the app that owns them and marks them reachable", () => {
    const list = candidatesFromPorts([7890, 1080, 65000])
    expect(list).toEqual([
      {
        id: "port:Clash / Clash for Windows",
        source: "port",
        url: "http://127.0.0.1:7890",
        detail: "Clash / Clash for Windows",
        reachable: true,
      },
      {
        id: "port:SOCKS5",
        source: "port",
        url: "socks5://127.0.0.1:1080",
        detail: "SOCKS5",
        reachable: true,
      },
    ])
  })
})

describe("dedupeCandidates", () => {
  it("keeps the highest-priority source and merges the others into detail", () => {
    const merged = dedupeCandidates([
      {
        id: "port:Clash",
        source: "port",
        url: "http://127.0.0.1:7890",
        detail: "Clash",
        reachable: true,
      },
      { id: "env:HTTPS_PROXY", source: "env", url: "http://127.0.0.1:7890", detail: "HTTPS_PROXY" },
      { id: "npm:proxy", source: "npm", url: "http://127.0.0.1:7890", detail: "proxy" },
    ])
    expect(merged).toEqual([
      {
        id: "env:HTTPS_PROXY",
        source: "env",
        url: "http://127.0.0.1:7890",
        detail: "HTTPS_PROXY · proxy · Clash",
        reachable: true,
      },
    ])
  })

  it("never repeats the same detail twice", () => {
    const merged = dedupeCandidates([
      { id: "npm:proxy", source: "npm", url: "http://p:1", detail: "proxy" },
      { id: "npm:https-proxy", source: "npm", url: "http://p:1", detail: "proxy" },
    ])
    expect(merged[0].detail).toBe("proxy")
  })
})

describe("discoverProxies", () => {
  it("merges all four sources, ranks env first and sweeps every known port", async () => {
    const probed: number[] = []
    const result = await discoverProxies(
      probes({
        envSnapshot: async () =>
          env({ httpsProxy: "http://corp:8080", noProxy: "localhost .corp" }),
        systemSnapshot: async () => ({
          entries: [{ scheme: "http", host: "corp", port: 8080 }],
          pacUrl: "http://corp/proxy.pac",
          bypass: ["ignored"],
        }),
        toolSnapshot: async () => tools({ gitHttpProxy: "http://git:3128" }),
        probePort: async (port) => {
          probed.push(port)
          return port === 7897
        },
      })
    )
    expect(probed.sort((a, b) => a - b)).toEqual(
      WELL_KNOWN_PROXY_PORTS.map((p) => p.port).sort((a, b) => a - b)
    )
    expect(result.candidates.map((c) => `${c.source}:${c.url}`)).toEqual([
      "env:http://corp:8080",
      "git:http://git:3128",
      "port:http://127.0.0.1:7897",
    ])
    // The system entry is the same endpoint as HTTPS_PROXY → one merged row.
    expect(result.candidates[0].detail).toBe("HTTPS_PROXY · http")
    expect(result.pacUrl).toBe("http://corp/proxy.pac")
    // env NO_PROXY wins over the OS exception list.
    expect(result.noProxy).toBe("localhost,.corp")
  })

  it("falls back to the OS bypass list, then npm's, for NO_PROXY", async () => {
    const fromSystem = await discoverProxies(
      probes({ systemSnapshot: async () => system({ bypass: ["*.corp", "localhost"] }) })
    )
    expect(fromSystem.noProxy).toBe("*.corp,localhost")
    const fromNpm = await discoverProxies(
      probes({ toolSnapshot: async () => tools({ npmNoProxy: "a,b" }) })
    )
    expect(fromNpm.noProxy).toBe("a,b")
  })

  it("survives a source that throws", async () => {
    const result = await discoverProxies(
      probes({
        envSnapshot: async () => {
          throw new Error("ipc down")
        },
        systemSnapshot: async () => {
          throw new Error("no scutil")
        },
        toolSnapshot: async () => {
          throw new Error("no npm")
        },
        probePort: async (port) => {
          if (port === 7890) return true
          throw new Error("probe failed")
        },
      })
    )
    expect(result.candidates.map((c) => c.url)).toEqual(["http://127.0.0.1:7890"])
    expect(result.pacUrl).toBeNull()
    expect(result.noProxy).toBeNull()
  })
})
