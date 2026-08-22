import type { Command } from "../types"
import { classifyFailure, failureEvidence, remediesFor, type RecoveryContext } from "./recovery"

describe("failureEvidence", () => {
  it("hands back the line the verdict came from, trimmed", () => {
    const output = ["npm WARN deprecated", "  curl: (28) Operation timed out  ", "exit 1"]
    expect(failureEvidence(output, "network")).toBe("curl: (28) Operation timed out")
  })

  it("has nothing to quote for a verdict with no patterns", () => {
    expect(failureEvidence(["anything at all"], "other")).toBeUndefined()
  })

  it("has nothing to quote when no single line reproduces the match", () => {
    // The caller renders no quote rather than an invented one.
    expect(failureEvidence(["all quiet"], "network")).toBeUndefined()
    expect(failureEvidence([], "permission")).toBeUndefined()
  })

  it("quotes the first match, so it agrees with the verdict's own reasoning", () => {
    const output = ["ETIMEDOUT while fetching", "ECONNRESET later on"]
    expect(failureEvidence(output, "network")).toBe("ETIMEDOUT while fetching")
  })
})

describe("classifyFailure", () => {
  // Real output lines, quoted the way each tool actually prints them — the whole
  // point of this table is that it fails if a pattern stops matching reality.
  const NETWORK_CASES: [string, string][] = [
    [
      "npm timeout",
      "npm ERR! network request to https://registry.npmjs.org/abbrev failed, reason: connect ETIMEDOUT 104.16.0.35:443",
    ],
    ["npm reset", "npm ERR! network read ECONNRESET"],
    ["npm dns", "npm ERR! code ENOTFOUND"],
    ["npm eai_again", "npm ERR! errno EAI_AGAIN"],
    [
      "pnpm fetch",
      "ERR_PNPM_FETCH_404  GET https://registry.npmjs.org/x: request to https://registry.npmjs.org/x failed",
    ],
    ["winget download", "Failed when downloading installer. Reason: 0x8a150044"],
    ["winget hash", "Installer hash does not match; sha256 mismatch"],
    ["winget dns", "An unexpected error occurred: 0x80072EE7"],
    ["winget connect", "Error: 0x80072EFD"],
    ["brew curl timeout", "curl: (28) Operation timed out after 30001 milliseconds"],
    ["brew curl tls", "curl: (35) OpenSSL SSL_connect: Connection reset by peer"],
    ["brew dns", "curl: (6) Could not resolve host: ghcr.io"],
    ["brew download", 'Error: Failed to download resource "cc-switch"'],
    ["powershell dns", "Invoke-RestMethod : The remote name could not be resolved: 'bun.com'"],
    ["powershell connect", "Unable to connect to the remote server"],
    ["generic reset", "fatal: unable to access: Connection reset by peer"],
    ["generic unreachable", "connect: Network is unreachable"],
    ["tls expired", "SSL certificate problem: certificate has expired"],
  ]

  it.each(NETWORK_CASES)("classifies %s as network", (_name, line) => {
    expect(classifyFailure([line])).toBe("network")
  })

  const PERMISSION_CASES: [string, string][] = [
    ["windows denied", "Access is denied. (0x80070005)"],
    [
      "npm eacces",
      "npm ERR! Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules'",
    ],
    ["unix perm", "mkdir: Permission denied"],
    ["needs admin", "This package requires elevation to install."],
  ]

  it.each(PERMISSION_CASES)("classifies %s as permission, never network", (_name, line) => {
    expect(classifyFailure([line])).toBe("permission")
  })

  it("classifies a missing binary as notFound", () => {
    expect(classifyFailure(["command not found: winget"])).toBe("notFound")
    expect(classifyFailure(["'npm' is not recognized as an internal or external command"])).toBe(
      "notFound"
    )
  })

  it("takes the most specific reading when signals overlap", () => {
    // A permission failure that also happens to say "connection" must not be
    // retried against a mirror — retrying can never fix rights.
    expect(classifyFailure(["Access is denied.", "connection reset by peer"])).toBe("permission")
    // Likewise a missing binary outranks everything.
    expect(classifyFailure(["command not found: brew", "curl: (28) Operation timed out"])).toBe(
      "notFound"
    )
  })

  it("leaves an unrecognised failure alone rather than guessing", () => {
    expect(classifyFailure(["npm ERR! code EBADENGINE", "Unsupported engine"])).toBe("other")
    expect(classifyFailure([])).toBe("other")
    // An exit code on its own is far too weak a signal to start rewriting commands.
    expect(classifyFailure(["something went wrong"], 1)).toBe("other")
  })
})

describe("remediesFor", () => {
  const ctx: RecoveryContext = {
    proxyUrl: "http://127.0.0.1:7890",
    npmRegistry: "https://registry.npmmirror.com",
    pypiIndex: "https://pypi.tuna.tsinghua.edu.cn/simple",
    brewEnv: {
      HOMEBREW_API_DOMAIN: "https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles/api",
      HOMEBREW_BOTTLE_DOMAIN: "https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles",
    },
  }
  const bare: RecoveryContext = { proxyUrl: null, npmRegistry: null, pypiIndex: null }
  const npmInstall: Command = { file: "npm", args: ["install", "-g", "@anthropic-ai/claude-code"] }

  it("climbs npm: mirror, then mirror+proxy, then proxy alone", () => {
    const ladder = remediesFor(npmInstall, ctx)

    expect(ladder.map((r) => r.id)).toEqual(["npm-registry", "npm-registry+proxy", "proxy"])
    expect(ladder[0].command.args).toEqual([
      "install",
      "-g",
      "@anthropic-ai/claude-code",
      "--registry=https://registry.npmmirror.com",
    ])
    expect(ladder[0].env).toBeUndefined()
    expect(ladder[1].command.args).toEqual(ladder[0].command.args)
    expect(ladder[1].env).toMatchObject({ HTTPS_PROXY: "http://127.0.0.1:7890" })
    // The last rung leaves the registry untouched.
    expect(ladder[2].command).toEqual(npmInstall)
  })

  it("emits proxy variables in both cases, because curl only reads lowercase", () => {
    const [, , proxyOnly] = remediesFor(npmInstall, ctx)
    expect(proxyOnly.env).toMatchObject({
      HTTP_PROXY: "http://127.0.0.1:7890",
      HTTPS_PROXY: "http://127.0.0.1:7890",
      http_proxy: "http://127.0.0.1:7890",
      https_proxy: "http://127.0.0.1:7890",
    })
  })

  it("routes a SOCKS proxy to ALL_PROXY only", () => {
    const ladder = remediesFor(npmInstall, { ...ctx, proxyUrl: "socks5://127.0.0.1:1080" })
    const proxyOnly = ladder.find((r) => r.id === "proxy")!
    expect(proxyOnly.env).toMatchObject({
      ALL_PROXY: "socks5://127.0.0.1:1080",
      all_proxy: "socks5://127.0.0.1:1080",
    })
    expect(proxyOnly.env).not.toHaveProperty("HTTPS_PROXY")
  })

  it("carries a NO_PROXY bypass list alongside the proxy", () => {
    const ladder = remediesFor(npmInstall, { ...ctx, noProxy: "localhost,127.0.0.1" })
    expect(ladder.find((r) => r.id === "proxy")!.env).toMatchObject({
      NO_PROXY: "localhost,127.0.0.1",
    })
  })

  it("offers nothing when there is no mirror and no proxy to reach for", () => {
    expect(remediesFor(npmInstall, bare)).toEqual([])
  })

  it("skips npm verbs that never touch a registry", () => {
    expect(remediesFor({ file: "npm", args: ["uninstall", "-g", "pkg"] }, ctx)).toEqual([])
    expect(remediesFor({ file: "npm", args: ["config", "set", "registry", "x"] }, ctx)).toEqual([])
  })

  it("points npx at a mirror through npm_config_registry, not a flag", () => {
    const ladder = remediesFor({ file: "npx", args: ["-y", "@some/mcp"] }, ctx)
    expect(ladder[0].id).toBe("npx-registry")
    // The command is untouched — splicing a flag in would land after the package
    // name and be passed to the package instead of to npx.
    expect(ladder[0].command.args).toEqual(["-y", "@some/mcp"])
    expect(ladder[0].env).toEqual({ npm_config_registry: "https://registry.npmmirror.com" })
  })

  it("points bun at a mirror through BUN_CONFIG_REGISTRY", () => {
    const ladder = remediesFor({ file: "bun", args: ["add", "-g", "opencode-ai"] }, ctx)
    expect(ladder[0].env).toEqual({ BUN_CONFIG_REGISTRY: "https://registry.npmmirror.com" })
  })

  it("climbs brew through both Homebrew domain variables", () => {
    const ladder = remediesFor({ file: "brew", args: ["install", "--cask", "cc-switch"] }, ctx)
    expect(ladder.map((r) => r.id)).toEqual(["brew-mirror", "brew-mirror+proxy", "proxy"])
    expect(ladder[0].env).toEqual(ctx.brewEnv)
    expect(ladder[1].env).toMatchObject({ ...ctx.brewEnv, HTTPS_PROXY: "http://127.0.0.1:7890" })
  })

  it("points uv at a PyPI index", () => {
    const ladder = remediesFor({ file: "uvx", args: ["mcp-server-fetch"] }, ctx)
    expect(ladder[0].env).toEqual({
      UV_DEFAULT_INDEX: "https://pypi.tuna.tsinghua.edu.cn/simple",
      PIP_INDEX_URL: "https://pypi.tuna.tsinghua.edu.cn/simple",
    })
  })

  it("gives a script installer the proxy only — there is no mirror for it", () => {
    const curl: Command = {
      file: "bash",
      args: ["-c", "curl -fsSL https://claude.ai/install.sh | bash"],
    }
    const ladder = remediesFor(curl, ctx)
    expect(ladder.map((r) => r.id)).toEqual(["proxy"])
    expect(ladder[0].command).toEqual(curl)
  })

  it("offers winget nothing, because WinINet ignores the proxy variables", () => {
    // winget downloads through WinINet, which reads the *system* proxy and not
    // HTTPS_PROXY — a retry with proxy vars would look plausible and never work.
    // Its real recovery (scoop, GitHub Release) rides on the step's fallbacks.
    const winget: Command = {
      file: "winget",
      args: ["install", "-e", "--id", "farion1231.CC-Switch"],
    }
    expect(remediesFor(winget, ctx)).toEqual([])
  })

  it("offers nothing for a command that never touches the network", () => {
    expect(remediesFor({ file: "claude", args: ["mcp", "add", "memory"] }, ctx)).toEqual([])
  })

  describe("persist hints", () => {
    it("marks a registry remedy as persistable to npm config", () => {
      const ladder = remediesFor(npmInstall, ctx)
      expect(ladder[0].persist).toEqual({
        kind: "npmRegistry",
        url: "https://registry.npmmirror.com",
      })
    })

    it("marks a proxy remedy as persistable to the proxy config", () => {
      const ladder = remediesFor(npmInstall, ctx)
      expect(ladder.at(-1)!.persist).toEqual({ kind: "proxy", url: "http://127.0.0.1:7890" })
    })

    it("leaves brew and uv remedies unpersistable — there is no writer for them", () => {
      const brew = remediesFor({ file: "brew", args: ["install", "wget"] }, ctx)
      expect(brew[0].persist).toBeUndefined()
      const uv = remediesFor({ file: "uvx", args: ["mcp-server-fetch"] }, ctx)
      expect(uv[0].persist).toBeUndefined()
    })
  })
})
