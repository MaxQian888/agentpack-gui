import type { ProxyConfig } from "../types"
import {
  DEFAULT_PROXY,
  PROXY_ENV_KEYS,
  effectiveProxy,
  isProxyActive,
  normalizeNoProxy,
  normalizeProxyUrl,
  proxyEnvVars,
  shellExportLines,
  shellFlavor,
  socksUnsupported,
  withCredentials,
} from "./proxy"

const manual = (patch: Partial<ProxyConfig> = {}): ProxyConfig => ({
  ...DEFAULT_PROXY,
  mode: "manual",
  ...patch,
})

describe("normalizeProxyUrl", () => {
  it("assumes http for a bare host:port (what proxy apps display)", () => {
    expect(normalizeProxyUrl("127.0.0.1:7890")).toMatchObject({
      url: "http://127.0.0.1:7890",
      scheme: "http",
      host: "127.0.0.1",
      port: 7890,
      hasAuth: false,
    })
  })

  it("keeps socks schemes and their default port", () => {
    expect(normalizeProxyUrl("socks5://127.0.0.1")).toMatchObject({
      url: "socks5://127.0.0.1",
      scheme: "socks5",
      port: 1080,
    })
  })

  it("drops a redundant default port and any path", () => {
    expect(normalizeProxyUrl("http://proxy.example.com:80/ignored")?.url).toBe(
      "http://proxy.example.com"
    )
  })

  it("preserves IPv6 brackets", () => {
    expect(normalizeProxyUrl("http://[::1]:7890")).toMatchObject({
      url: "http://[::1]:7890",
      host: "::1",
      port: 7890,
    })
  })

  it("reports credentials already present in the URL", () => {
    const parsed = normalizeProxyUrl("http://u:p@proxy.example.com:8080")
    expect(parsed?.hasAuth).toBe(true)
    expect(parsed?.url).toBe("http://u:p@proxy.example.com:8080")
  })

  it("rejects empty, unparseable and unsupported values", () => {
    for (const bad of ["", "   ", "ftp://host:21", "http://", "not a url", "http://h:0"]) {
      expect(normalizeProxyUrl(bad)).toBeNull()
    }
    expect(normalizeProxyUrl(undefined)).toBeNull()
  })
})

describe("withCredentials", () => {
  it("injects and percent-encodes the userinfo", () => {
    const url = withCredentials("http://proxy.example.com:8080", "me@corp", "p@ss:word")
    expect(url).toBe("http://me%40corp:p%40ss%3Aword@proxy.example.com:8080")
    // Round-trips: the parser reads it back as a single credentialed proxy.
    expect(normalizeProxyUrl(url)).toMatchObject({ host: "proxy.example.com", hasAuth: true })
  })

  it("leaves a URL that already carries credentials alone", () => {
    expect(withCredentials("http://a:b@proxy:8080", "other", "pw")).toBe("http://a:b@proxy:8080")
  })

  it("is a no-op without a username", () => {
    expect(withCredentials("http://proxy:8080", "", "pw")).toBe("http://proxy:8080")
  })
})

describe("normalizeNoProxy", () => {
  it("accepts space- and comma-separated lists and collapses to commas", () => {
    expect(normalizeNoProxy("localhost 127.0.0.1 .corp.example")).toBe(
      "localhost,127.0.0.1,.corp.example"
    )
    expect(normalizeNoProxy(" a , b,, c ")).toBe("a,b,c")
  })

  it("returns undefined for nothing usable", () => {
    expect(normalizeNoProxy("  ,, ")).toBeUndefined()
    expect(normalizeNoProxy(null)).toBeUndefined()
  })
})

describe("effectiveProxy", () => {
  it("cross-fills the missing scheme from the one that is set", () => {
    expect(effectiveProxy(manual({ httpUrl: "127.0.0.1:7890" }))).toEqual({
      http: "http://127.0.0.1:7890",
      https: "http://127.0.0.1:7890",
    })
    expect(effectiveProxy(manual({ httpsUrl: "127.0.0.1:7890" }))).toEqual({
      http: "http://127.0.0.1:7890",
      https: "http://127.0.0.1:7890",
    })
  })

  it("keeps distinct per-scheme proxies apart", () => {
    const eff = effectiveProxy(manual({ httpUrl: "http://a:1", httpsUrl: "http://b:2" }))
    expect(eff).toEqual({ http: "http://a:1", https: "http://b:2" })
  })

  it("applies credentials to every URL it resolves", () => {
    const eff = effectiveProxy(
      manual({ httpUrl: "proxy:8080", allUrl: "socks5://proxy:1080", username: "u", password: "p" })
    )
    expect(eff.http).toBe("http://u:p@proxy:8080")
    expect(eff.all).toBe("socks5://u:p@proxy:1080")
  })

  it("resolves to nothing when off", () => {
    expect(effectiveProxy({ ...manual({ httpUrl: "proxy:8080" }), mode: "off" })).toEqual({})
    expect(effectiveProxy(undefined)).toEqual({})
  })

  it("treats system mode exactly like manual (the fields carry the values)", () => {
    const cfg = manual({ mode: "system", httpUrl: "proxy:8080" })
    expect(effectiveProxy(cfg)).toEqual(effectiveProxy(manual({ httpUrl: "proxy:8080" })))
  })
})

describe("isProxyActive", () => {
  it("needs a usable URL, not just a mode", () => {
    expect(isProxyActive(manual())).toBe(false)
    expect(isProxyActive(manual({ httpUrl: "nonsense url" }))).toBe(false)
    expect(isProxyActive(manual({ httpUrl: "proxy:8080" }))).toBe(true)
    expect(isProxyActive(undefined)).toBe(false)
  })
})

describe("proxyEnvVars", () => {
  it("writes the documented variable names", () => {
    const vars = proxyEnvVars(
      manual({
        httpUrl: "http://p:1",
        httpsUrl: "http://p:2",
        allUrl: "socks5://p:1080",
        noProxy: "localhost .corp",
        caCertPath: "/etc/ca.pem",
        insecureTls: true,
        clientCertPath: "/c.pem",
        clientKeyPath: "/k.pem",
        clientKeyPassphrase: "secret",
      })
    )
    expect(vars).toEqual({
      HTTP_PROXY: "http://p:1",
      HTTPS_PROXY: "http://p:2",
      ALL_PROXY: "socks5://p:1080",
      NO_PROXY: "localhost,.corp",
      NODE_EXTRA_CA_CERTS: "/etc/ca.pem",
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      CLAUDE_CODE_CLIENT_CERT: "/c.pem",
      CLAUDE_CODE_CLIENT_KEY: "/k.pem",
      CLAUDE_CODE_CLIENT_KEY_PASSPHRASE: "secret",
    })
  })

  it("only writes what is filled in, and nothing at all when off", () => {
    expect(proxyEnvVars(manual({ httpUrl: "http://p:1" }))).toEqual({
      HTTP_PROXY: "http://p:1",
      HTTPS_PROXY: "http://p:1",
    })
    expect(proxyEnvVars({ ...manual({ httpUrl: "http://p:1" }), mode: "off" })).toEqual({})
  })

  it("skips the mTLS passphrase without a cert+key pair", () => {
    const vars = proxyEnvVars(manual({ httpUrl: "http://p:1", clientKeyPassphrase: "secret" }))
    expect(vars["CLAUDE_CODE_CLIENT_KEY_PASSPHRASE"]).toBeUndefined()
  })

  it("never writes a key outside PROXY_ENV_KEYS (the clear path removes exactly these)", () => {
    const vars = proxyEnvVars(
      manual({
        httpUrl: "http://p:1",
        allUrl: "socks5://p:1080",
        noProxy: "x",
        caCertPath: "/c",
        insecureTls: true,
        clientCertPath: "/c",
        clientKeyPath: "/k",
        clientKeyPassphrase: "s",
      })
    )
    expect(Object.keys(vars).sort()).toEqual([...PROXY_ENV_KEYS].sort())
  })
})

describe("socksUnsupported", () => {
  it("flags a SOCKS-only config aimed at Claude Code", () => {
    expect(socksUnsupported(manual({ allUrl: "socks5://p:1080" }))).toBe(true)
  })

  it("stays quiet when an http proxy is also set, or Claude isn't a target", () => {
    expect(socksUnsupported(manual({ allUrl: "socks5://p:1080", httpUrl: "http://p:1" }))).toBe(
      false
    )
    expect(socksUnsupported(manual({ allUrl: "socks5://p:1080", targets: ["npm"] }))).toBe(false)
  })
})

describe("shellExportLines", () => {
  it("emits both cases for proxy vars, uppercase only for the rest", () => {
    const lines = shellExportLines(manual({ httpUrl: "http://p:1", caCertPath: "/ca.pem" }))
    expect(lines).toEqual([
      'export HTTP_PROXY="http://p:1"',
      'export http_proxy="http://p:1"',
      'export HTTPS_PROXY="http://p:1"',
      'export https_proxy="http://p:1"',
      'export NODE_EXTRA_CA_CERTS="/ca.pem"',
    ])
  })

  it("uses fish syntax for a fish profile", () => {
    expect(shellFlavor("/Users/x/.config/fish/config.fish")).toBe("fish")
    expect(shellFlavor("/Users/x/.zshrc")).toBe("posix")
    expect(shellExportLines(manual({ httpUrl: "http://p:1" }), "fish")[0]).toBe(
      'set -gx HTTP_PROXY "http://p:1"'
    )
  })

  it("is empty when the proxy is off", () => {
    expect(shellExportLines(DEFAULT_PROXY)).toEqual([])
  })
})
