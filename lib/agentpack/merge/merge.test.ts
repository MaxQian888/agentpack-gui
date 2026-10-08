import {
  buildClaudeMcpCommand,
  buildClaudeMcpCommandFromSpec,
  buildClaudeMcpEntryFromSpec,
  buildClaudeMcpRemoveCommand,
  buildCodexMcpEntry,
  buildCodexMcpEntryFromSpec,
  buildOpencodeMcpEntry,
  buildOpencodeMcpEntryFromSpec,
  deleteCodexMcpEntry,
  deleteOpencodeMcpEntry,
  mergeClaudeMcp,
  mergeCodexMcp,
  mergeOpencodeMcp,
  parseClaudeMcpEntry,
  parseCodexMcpEntry,
  parseOpencodeMcpEntry,
  removeClaudeMcp,
  resolveCatalogSpec,
  setCodexMcpEnabled,
  setOpencodeMcpEnabled,
  specFromClaudeRecord,
  specFromOpencodeRecord,
  wrapStdioForOs,
  type McpSpec,
} from "./mcp"
import {
  SHELL_BLOCK_END,
  SHELL_BLOCK_START,
  deleteClaudeProxy,
  deleteShellProxyBlock,
  gitProxyClearCommands,
  gitProxyCommands,
  mergeClaudeEnv,
  mergeClaudeProxy,
  mergeShellProxyBlock,
  npmProxyClearCommands,
  npmProxyCommands,
  npmRegistryCommand,
  winProxyClearCommands,
  winProxyCommands,
} from "./network"
import { claudeSettingsFromProvider } from "../ccswitch/sync"
import { findMcp } from "../registry"
import type { McpServer, ProxyConfig } from "../types"

it("http MCP adds bearer header for Claude", () => {
  const cmd = buildClaudeMcpCommand(findMcp("supermemory")!, "k")
  expect(cmd.args).toEqual(expect.arrayContaining(["--transport", "http"]))
  expect(cmd.args.join(" ")).toContain("Authorization: Bearer k")
})

it("codex stdio entry embeds env key", () => {
  const e = buildCodexMcpEntry(findMcp("context7")!, "abc") as Record<string, unknown>
  expect(e.command).toBe("npx")
  expect(e.env).toEqual({ CONTEXT7_API_KEY: "abc" })
})

it("mergeCodexMcp is idempotent per id", () => {
  let toml = mergeCodexMcp("", "context7", { command: "npx", args: [] })
  toml = mergeCodexMcp(toml, "context7", { command: "npx", args: ["x"] })
  expect((toml.match(/context7/g) ?? []).length).toBe(1)
})

it("mergeClaudeEnv sets env block", () => {
  const out = mergeClaudeEnv("", { HTTP_PROXY: "http://p" })
  expect(JSON.parse(out).env.HTTP_PROXY).toBe("http://p")
})

it("npmRegistryCommand builds an npm config set call", () => {
  expect(npmRegistryCommand("https://m")).toEqual({
    file: "npm",
    args: ["config", "set", "registry", "https://m"],
  })
})

it("claude stdio command omits --env when no key, embeds it when present", () => {
  const noKey = buildClaudeMcpCommand(findMcp("context7")!, undefined)
  expect(noKey.args).not.toContain("--env")
  expect(noKey.args.join(" ")).toContain("--scope user")
  const withKey = buildClaudeMcpCommand(findMcp("context7")!, "abc")
  expect(withKey.args.join(" ")).toContain("CONTEXT7_API_KEY=abc")
})

it("claude http references the keyEnv when no literal key is given (env-reference-first)", () => {
  // With no pasted key, fall back to referencing the catalog's keyEnv via
  // Claude's ${VAR} expansion rather than inlining nothing.
  const cmd = buildClaudeMcpCommand(findMcp("supermemory")!, "   ")
  expect(cmd.args.join(" ")).not.toContain("Authorization: Bearer   ")
  expect(cmd.args.join(" ")).toContain("Authorization: Bearer ${SUPERMEMORY_API_KEY}")
})

it("claude stdio command appends extraArgs", () => {
  const cmd = buildClaudeMcpCommand(findMcp("filesystem")!, undefined)
  expect(cmd.args[cmd.args.length - 1]).toBe(".")
})

it("codex http entry references the bearer env var name", () => {
  const e = buildCodexMcpEntry(findMcp("supermemory")!, "k") as Record<string, unknown>
  expect(e.url).toBe("https://mcp.supermemory.ai/mcp")
  expect(e.bearer_token_env_var).toBe("SUPERMEMORY_API_KEY")
})

it("codex stdio entry omits env when no key is supplied", () => {
  const e = buildCodexMcpEntry(findMcp("context7")!, undefined) as Record<string, unknown>
  expect(e.env).toBeUndefined()
})

it("mergeClaudeEnv preserves an existing env block and other fields", () => {
  const existing = JSON.stringify({ env: { KEEP: "1" }, other: true })
  const out = JSON.parse(mergeClaudeEnv(existing, { HTTP_PROXY: "http://p" }))
  expect(out.env.KEEP).toBe("1")
  expect(out.env.HTTP_PROXY).toBe("http://p")
  expect(out.other).toBe(true)
})

it("mergeClaudeEnv deletes a key when the value is null", () => {
  const existing = JSON.stringify({ env: { KEEP: "1", DROP: "2" } })
  const out = JSON.parse(mergeClaudeEnv(existing, { DROP: null }))
  expect(out.env.KEEP).toBe("1")
  expect(out.env.DROP).toBeUndefined()
})

it("buildClaudeMcpRemoveCommand targets the id with user scope", () => {
  expect(buildClaudeMcpRemoveCommand("context7")).toEqual({
    file: "claude",
    args: ["mcp", "remove", "context7", "--scope", "user"],
  })
})

it("deleteCodexMcpEntry drops the named table and keeps the rest", () => {
  let toml = mergeCodexMcp("", "context7", { command: "npx", args: [] })
  toml = mergeCodexMcp(toml, "memory", { command: "npx", args: [] })
  const out = deleteCodexMcpEntry(toml, "context7")
  expect(out).not.toContain("context7")
  expect(out).toContain("memory")
})

it("deleteCodexMcpEntry is a no-op for an unknown id or empty input", () => {
  const toml = mergeCodexMcp("", "memory", { command: "npx", args: [] })
  expect(deleteCodexMcpEntry(toml, "nope")).toContain("memory")
  expect(deleteCodexMcpEntry("", "memory")).toBe("")
})

// --- OpenCode target + custom-spec + reverse parsers ---------------------

it("opencode stdio entry uses type:local, a command array and `environment`", () => {
  const e = buildOpencodeMcpEntry(findMcp("context7")!, "abc")
  expect(e.type).toBe("local")
  expect(e.command).toEqual(["npx", "-y", "@upstash/context7-mcp"])
  expect(e.enabled).toBe(true)
  expect(e.environment).toEqual({ CONTEXT7_API_KEY: "abc" })
  expect(e.env).toBeUndefined() // never the Codex `env` key
})

it("opencode http entry uses type:remote with inline headers", () => {
  const e = buildOpencodeMcpEntry(findMcp("supermemory")!, "k")
  expect(e.type).toBe("remote")
  expect(e.url).toBe("https://mcp.supermemory.ai/mcp")
  expect(e.headers).toEqual({ Authorization: "Bearer k" })
})

it("mergeOpencodeMcp writes mcp.<id> and preserves other keys, idempotent", () => {
  const existing = JSON.stringify({ theme: "dark", mcp: { keep: { type: "local" } } })
  let out = mergeOpencodeMcp(existing, "context7", { type: "local", command: ["npx"] })
  out = mergeOpencodeMcp(out, "context7", { type: "local", command: ["npx", "-y"] })
  const parsed = JSON.parse(out)
  expect(parsed.theme).toBe("dark")
  expect(parsed.mcp.keep).toEqual({ type: "local" })
  expect(parsed.mcp.context7.command).toEqual(["npx", "-y"])
  expect(Object.keys(parsed.mcp)).toEqual(["keep", "context7"])
})

it("mergeOpencodeMcp throws on malformed JSON rather than clobbering", () => {
  expect(() => mergeOpencodeMcp("{not json", "x", { type: "local" })).toThrow()
})

it("deleteOpencodeMcpEntry prunes the id, and prunes an emptied mcp object", () => {
  const two = mergeOpencodeMcp(mergeOpencodeMcp("", "a", { type: "local" }), "b", { type: "local" })
  const afterA = JSON.parse(deleteOpencodeMcpEntry(two, "a"))
  expect(afterA.mcp).toEqual({ b: { type: "local" } })
  const emptied = JSON.parse(deleteOpencodeMcpEntry(mergeOpencodeMcp("", "only", {}), "only"))
  expect(emptied.mcp).toBeUndefined()
  expect(deleteOpencodeMcpEntry("", "x")).toBe("")
})

it("custom stdio spec writes any command across all three targets", () => {
  const spec: McpSpec = {
    transport: "stdio",
    command: "uvx",
    args: ["some-mcp", "--flag"],
    env: { TOKEN: "t" },
  }
  const claude = buildClaudeMcpCommandFromSpec("mine", spec)
  expect(claude.args.join(" ")).toContain("-- uvx some-mcp --flag")
  expect(claude.args.join(" ")).toContain("--env TOKEN=t")
  expect(buildCodexMcpEntryFromSpec(spec)).toEqual({
    command: "uvx",
    args: ["some-mcp", "--flag"],
    env: { TOKEN: "t" },
  })
  expect(buildOpencodeMcpEntryFromSpec(spec)).toEqual({
    type: "local",
    command: ["uvx", "some-mcp", "--flag"],
    enabled: true,
    environment: { TOKEN: "t" },
  })
})

it("custom http spec: Codex uses bearer env var, Claude/OpenCode inline headers", () => {
  const spec: McpSpec = {
    transport: "http",
    url: "https://x/mcp",
    headers: { Authorization: "Bearer secret", "X-Extra": "1" },
    bearerTokenEnvVar: "MY_TOKEN",
  }
  expect(buildCodexMcpEntryFromSpec(spec)).toEqual({
    url: "https://x/mcp",
    bearer_token_env_var: "MY_TOKEN",
  })
  const claude = buildClaudeMcpCommandFromSpec("mine", spec).args.join(" ")
  expect(claude).toContain("--header Authorization: Bearer secret")
  expect(claude).toContain("--header X-Extra: 1")
  expect(buildOpencodeMcpEntryFromSpec(spec)).toEqual({
    type: "remote",
    url: "https://x/mcp",
    enabled: true,
    headers: { Authorization: "Bearer secret", "X-Extra": "1" },
  })
})

it("launches a uvx server without npx's -y flag", () => {
  // uvx is already non-interactive; a leading `-y` would be read as the package
  // name and the server would never start.
  const spec = resolveCatalogSpec(findMcp("fetch")!, undefined)
  expect(spec).toEqual({
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-fetch"],
    env: {},
  })
})

it("leaves a uvx command unwrapped on Windows (it is a real exe, not a shim)", () => {
  const spec = resolveCatalogSpec(findMcp("fetch")!, undefined)
  expect(wrapStdioForOs(spec, "win")).toEqual(spec)
})

it("reverse parsers round-trip a catalog server per target", () => {
  const server = findMcp("context7")!
  const spec = resolveCatalogSpec(server, "abc")

  const claudeJson = JSON.stringify({
    mcpServers: {
      context7: {
        type: "stdio",
        command: "npx",
        args: spec.transport === "stdio" ? spec.args : [],
        env: { CONTEXT7_API_KEY: "abc" },
      },
    },
  })
  expect(parseClaudeMcpEntry(claudeJson, "context7")).toEqual({
    transport: "stdio",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    env: { CONTEXT7_API_KEY: "abc" },
  })

  const codexToml = mergeCodexMcp("", "context7", buildCodexMcpEntry(server, "abc"))
  expect(parseCodexMcpEntry(codexToml, "context7")).toEqual({
    transport: "stdio",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    env: { CONTEXT7_API_KEY: "abc" },
  })

  const opencodeJson = mergeOpencodeMcp("", "context7", buildOpencodeMcpEntry(server, "abc"))
  expect(parseOpencodeMcpEntry(opencodeJson, "context7")).toEqual({
    transport: "stdio",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    env: { CONTEXT7_API_KEY: "abc" },
  })
})

it("reverse parsers read http entries and are defensive on missing / bad input", () => {
  const claudeHttp = JSON.stringify({
    mcpServers: { s: { type: "http", url: "https://h", headers: { Authorization: "Bearer k" } } },
  })
  expect(parseClaudeMcpEntry(claudeHttp, "s")).toEqual({
    transport: "http",
    url: "https://h",
    headers: { Authorization: "Bearer k" },
  })
  const codexHttp = mergeCodexMcp("", "s", { url: "https://h", bearer_token_env_var: "T" })
  expect(parseCodexMcpEntry(codexHttp, "s")).toEqual({
    transport: "http",
    url: "https://h",
    headers: {},
    bearerTokenEnvVar: "T",
  })
  expect(parseClaudeMcpEntry("", "s")).toBeUndefined()
  expect(parseClaudeMcpEntry("{bad", "s")).toBeUndefined()
  expect(parseCodexMcpEntry("", "s")).toBeUndefined()
  expect(parseOpencodeMcpEntry("{}", "missing")).toBeUndefined()
})

it("tolerates servers missing url / package / keyEnv via defensive fallbacks", () => {
  const bareHttp = { id: "bare-http", transport: "http" } as McpServer
  const claudeHttp = buildClaudeMcpCommand(bareHttp, undefined)
  expect(claudeHttp.args).toContain("") // url ?? ""
  expect(buildCodexMcpEntry(bareHttp, "k")).toEqual({ url: "" })

  const bareStdio = { id: "bare-stdio", transport: "stdio" } as McpServer
  const claudeStdio = buildClaudeMcpCommand(bareStdio, "k")
  expect(claudeStdio.args).toContain("npx")
  const codexStdio = buildCodexMcpEntry(bareStdio, undefined) as Record<string, unknown>
  expect(codexStdio.command).toBe("npx")
})

// --- SSE transport -------------------------------------------------------

it("sse spec writes --transport sse for Claude and type:remote for OpenCode", () => {
  const spec: McpSpec = { transport: "sse", url: "https://x/sse", headers: {} }
  expect(buildClaudeMcpCommandFromSpec("s", spec).args).toEqual(
    expect.arrayContaining(["--transport", "sse", "s", "https://x/sse"])
  )
  // OpenCode has no separate SSE type — remote handles both.
  expect(buildOpencodeMcpEntryFromSpec(spec)).toEqual({
    type: "remote",
    url: "https://x/sse",
    enabled: true,
  })
  // Codex has no standalone SSE; the writer still yields a plain url entry
  // (plan.ts gates Codex out of an sse spec so this is never persisted there).
  expect(buildCodexMcpEntryFromSpec(spec)).toEqual({ url: "https://x/sse" })
})

it("parseClaudeMcpEntry recognizes type:sse", () => {
  const json = JSON.stringify({ mcpServers: { s: { type: "sse", url: "https://x/sse" } } })
  expect(parseClaudeMcpEntry(json, "s")).toEqual({
    transport: "sse",
    url: "https://x/sse",
    headers: {},
  })
})

// --- env references (secret-first) --------------------------------------

it("stdio envRefs render as native references per target", () => {
  const spec: McpSpec = {
    transport: "stdio",
    command: "npx",
    args: ["-y", "srv"],
    env: { PLAIN: "v" },
    envRefs: { GITHUB_TOKEN: "GITHUB_TOKEN" },
  }
  // Claude: ${VAR} expansion in --env
  expect(buildClaudeMcpCommandFromSpec("s", spec).args.join(" ")).toContain(
    "--env GITHUB_TOKEN=${GITHUB_TOKEN}"
  )
  // Codex: literal env table + env_vars whitelist (no interpolation)
  expect(buildCodexMcpEntryFromSpec(spec)).toEqual({
    command: "npx",
    args: ["-y", "srv"],
    env: { PLAIN: "v" },
    env_vars: ["GITHUB_TOKEN"],
  })
  // OpenCode: {env:VAR} in environment
  expect(buildOpencodeMcpEntryFromSpec(spec)).toEqual({
    type: "local",
    command: ["npx", "-y", "srv"],
    enabled: true,
    environment: { PLAIN: "v", GITHUB_TOKEN: "{env:GITHUB_TOKEN}" },
  })
})

it("http bearer reference (no inline key) references the env var on every target", () => {
  const spec: McpSpec = {
    transport: "http",
    url: "https://x/mcp",
    headers: {},
    bearerTokenEnvVar: "MY_TOKEN",
  }
  expect(buildClaudeMcpCommandFromSpec("s", spec).args.join(" ")).toContain(
    "Authorization: Bearer ${MY_TOKEN}"
  )
  expect(buildCodexMcpEntryFromSpec(spec)).toEqual({
    url: "https://x/mcp",
    bearer_token_env_var: "MY_TOKEN",
  })
  expect(buildOpencodeMcpEntryFromSpec(spec)).toEqual({
    type: "remote",
    url: "https://x/mcp",
    enabled: true,
    headers: { Authorization: "Bearer {env:MY_TOKEN}" },
  })
})

it("reverse parsers round-trip env / bearer references back into refs", () => {
  const stdio: McpSpec = {
    transport: "stdio",
    command: "npx",
    args: [],
    env: {},
    envRefs: { API_KEY: "API_KEY" },
  }
  const claudeJson = JSON.stringify({
    mcpServers: {
      s: { command: "npx", args: [], env: { API_KEY: "${API_KEY}" } },
    },
  })
  expect(parseClaudeMcpEntry(claudeJson, "s")).toEqual(stdio)

  const codexToml = mergeCodexMcp("", "s", buildCodexMcpEntryFromSpec(stdio))
  expect(parseCodexMcpEntry(codexToml, "s")).toEqual(stdio)

  const opencodeJson = mergeOpencodeMcp("", "s", buildOpencodeMcpEntryFromSpec(stdio))
  expect(parseOpencodeMcpEntry(opencodeJson, "s")).toEqual(stdio)

  // http bearer reference: Claude header ${VAR} → bearerTokenEnvVar
  const claudeHttp = JSON.stringify({
    mcpServers: {
      h: { type: "http", url: "https://h", headers: { Authorization: "Bearer ${T}" } },
    },
  })
  expect(parseClaudeMcpEntry(claudeHttp, "h")).toEqual({
    transport: "http",
    url: "https://h",
    headers: {},
    bearerTokenEnvVar: "T",
  })
})

// --- native enable/disable ----------------------------------------------

it("setCodexMcpEnabled toggles the enabled flag in place", () => {
  const toml = mergeCodexMcp("", "s", { command: "npx", args: [] })
  const off = setCodexMcpEnabled(toml, "s", false)
  expect(parseCodexMcpEntry(off, "s")).toBeDefined()
  expect(off).toMatch(/enabled\s*=\s*false/)
  const on = setCodexMcpEnabled(off, "s", true)
  expect(on).toMatch(/enabled\s*=\s*true/)
  // no-op on unknown id / empty input
  expect(setCodexMcpEnabled(toml, "nope", false)).toBe(toml)
  expect(setCodexMcpEnabled("", "s", false)).toBe("")
})

it("setOpencodeMcpEnabled toggles enabled and preserves the rest", () => {
  const json = mergeOpencodeMcp(JSON.stringify({ theme: "dark" }), "s", {
    type: "local",
    command: ["npx"],
    enabled: true,
  })
  const off = JSON.parse(setOpencodeMcpEnabled(json, "s", false))
  expect(off.mcp.s.enabled).toBe(false)
  expect(off.theme).toBe("dark")
  expect(setOpencodeMcpEnabled(json, "missing", false)).toBe(json)
  expect(setOpencodeMcpEnabled("", "s", false)).toBe("")
})

// --- Windows shim wrapping (cross-platform) -----------------------------

it("wrapStdioForOs wraps npm-family shims through cmd /c on Windows only", () => {
  const spec: McpSpec = { transport: "stdio", command: "npx", args: ["-y", "srv"], env: {} }
  expect(wrapStdioForOs(spec, "win")).toEqual({
    transport: "stdio",
    command: "cmd",
    args: ["/c", "npx", "-y", "srv"],
    env: {},
  })
  // No-op on mac/linux, for real exes, when already wrapped, and for remote specs.
  expect(wrapStdioForOs(spec, "mac")).toBe(spec)
  expect(wrapStdioForOs(spec, "linux")).toBe(spec)
  const uvx: McpSpec = { transport: "stdio", command: "uvx", args: ["srv"], env: {} }
  expect(wrapStdioForOs(uvx, "win")).toBe(uvx)
  const wrapped: McpSpec = { transport: "stdio", command: "cmd", args: ["/c", "npx"], env: {} }
  expect(wrapStdioForOs(wrapped, "win")).toBe(wrapped)
  const http: McpSpec = { transport: "http", url: "https://x", headers: {} }
  expect(wrapStdioForOs(http, "win")).toBe(http)
})

// --- Proxy ---------------------------------------------------------------

const proxy = (patch: Partial<ProxyConfig> = {}): ProxyConfig => ({
  mode: "manual",
  targets: ["claude", "npm", "git", "shell"],
  httpUrl: "http://127.0.0.1:7890",
  ...patch,
})

it("mergeClaudeProxy writes the proxy env vars and leaves the rest of the file alone", () => {
  const existing = JSON.stringify({ model: "opus", env: { KEEP: "1" } })
  const out = JSON.parse(mergeClaudeProxy(existing, proxy({ noProxy: "localhost" })))
  expect(out.model).toBe("opus")
  expect(out.env).toEqual({
    KEEP: "1",
    HTTP_PROXY: "http://127.0.0.1:7890",
    HTTPS_PROXY: "http://127.0.0.1:7890",
    NO_PROXY: "localhost",
  })
})

it("deleteClaudeProxy is the exact inverse and spares the provider's env vars", () => {
  // The proxy writer and the provider writer share settings.json `env`, so
  // clearing the proxy must leave the selected provider's endpoint intact.
  const withProvider = claudeSettingsFromProvider(
    JSON.stringify({ env: { KEEP: "1" } }),
    JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://r", ANTHROPIC_AUTH_TOKEN: "t" } })
  )
  const applied = mergeClaudeProxy(
    withProvider,
    proxy({ noProxy: "localhost", caCertPath: "/ca.pem", insecureTls: true })
  )
  const out = JSON.parse(deleteClaudeProxy(applied))
  expect(out.env).toEqual({
    KEEP: "1",
    ANTHROPIC_BASE_URL: "https://r",
    ANTHROPIC_AUTH_TOKEN: "t",
  })
})

it("deleteClaudeProxy returns empty input unchanged", () => {
  expect(deleteClaudeProxy("")).toBe("")
})

it("npm and git proxy commands cover exactly the keys those tools support", () => {
  const cfg = proxy({ noProxy: "localhost", allUrl: "socks5://127.0.0.1:1080" })
  expect(npmProxyCommands(cfg)).toEqual([
    { file: "npm", args: ["config", "set", "proxy", "http://127.0.0.1:7890"] },
    { file: "npm", args: ["config", "set", "https-proxy", "http://127.0.0.1:7890"] },
    { file: "npm", args: ["config", "set", "noproxy", "localhost"] },
  ])
  // git has no bypass-list key, and neither tool takes ALL_PROXY.
  expect(gitProxyCommands(cfg)).toEqual([
    { file: "git", args: ["config", "--global", "http.proxy", "http://127.0.0.1:7890"] },
    { file: "git", args: ["config", "--global", "https.proxy", "http://127.0.0.1:7890"] },
  ])
  expect(npmProxyClearCommands().map((c) => c.args[2])).toEqual(["proxy", "https-proxy", "noproxy"])
  expect(gitProxyClearCommands().map((c) => c.args[3])).toEqual(["http.proxy", "https.proxy"])
})

it("shell block is replaced in place, never stacked", () => {
  const original = "export PATH=/usr/bin\n"
  const once = mergeShellProxyBlock(original, proxy())
  expect(once).toContain("export PATH=/usr/bin")
  expect(once).toContain('export HTTP_PROXY="http://127.0.0.1:7890"')
  const twice = mergeShellProxyBlock(once, proxy({ httpUrl: "http://127.0.0.1:7897" }))
  expect(twice.match(new RegExp(SHELL_BLOCK_START, "g"))).toHaveLength(1)
  expect(twice).toContain("7897")
  expect(twice).not.toContain("7890")
  expect(twice).toContain("export PATH=/usr/bin")
})

it("deleteShellProxyBlock restores the profile to what the user wrote", () => {
  const original = "export PATH=/usr/bin\n"
  const applied = mergeShellProxyBlock(original, proxy())
  expect(deleteShellProxyBlock(applied).trim()).toBe(original.trim())
  // Idempotent, and a profile we never touched is returned verbatim.
  expect(deleteShellProxyBlock("nothing here\n")).toBe("nothing here\n")
})

it("shell block uses the profile's dialect and ends with its fence", () => {
  const fish = mergeShellProxyBlock("", proxy(), "fish")
  expect(fish).toContain('set -gx HTTP_PROXY "http://127.0.0.1:7890"')
  expect(fish.trim().endsWith(SHELL_BLOCK_END)).toBe(true)
})

it("an inactive proxy writes no block at all", () => {
  expect(mergeShellProxyBlock("keep me\n", { mode: "off", targets: [] })).toBe("keep me\n")
})

it("Windows setx commands mirror the env vars and clear the full key set", () => {
  expect(winProxyCommands(proxy({ noProxy: "localhost" }))).toEqual([
    { file: "setx", args: ["HTTP_PROXY", "http://127.0.0.1:7890"] },
    { file: "setx", args: ["HTTPS_PROXY", "http://127.0.0.1:7890"] },
    { file: "setx", args: ["NO_PROXY", "localhost"] },
  ])
  expect(winProxyClearCommands().every((c) => c.args[1] === "")).toBe(true)
  expect(winProxyClearCommands().map((c) => c.args[0])).toContain("HTTPS_PROXY")
})

describe("Claude config written directly (desktop-only route)", () => {
  it("writes an http entry with its inline headers", () => {
    expect(
      buildClaudeMcpEntryFromSpec({
        transport: "http",
        url: "https://x/mcp",
        headers: { "X-Org": "acme" },
      })
    ).toEqual({ type: "http", url: "https://x/mcp", headers: { "X-Org": "acme" } })
  })

  it("references the bearer env var only when no Authorization header is inline", () => {
    expect(
      buildClaudeMcpEntryFromSpec({
        transport: "sse",
        url: "https://x/sse",
        headers: {},
        bearerTokenEnvVar: "X_KEY",
      })
    ).toEqual({ type: "sse", url: "https://x/sse", headers: { Authorization: "Bearer ${X_KEY}" } })
    expect(
      buildClaudeMcpEntryFromSpec({
        transport: "http",
        url: "https://x/mcp",
        headers: { Authorization: "Bearer literal" },
        bearerTokenEnvVar: "X_KEY",
      })
    ).toEqual({ type: "http", url: "https://x/mcp", headers: { Authorization: "Bearer literal" } })
  })

  it("omits an empty headers block for an http entry", () => {
    expect(
      buildClaudeMcpEntryFromSpec({ transport: "http", url: "https://x/mcp", headers: {} })
    ).toEqual({ type: "http", url: "https://x/mcp" })
  })

  it("renders stdio env refs as ${VAR} and omits an empty env block", () => {
    const withRefs: McpSpec = {
      transport: "stdio",
      command: "uvx",
      args: ["tool"],
      env: { MODE: "fast" },
      envRefs: { API_KEY: "HOST_KEY" },
    }
    expect(buildClaudeMcpEntryFromSpec(withRefs)).toEqual({
      type: "stdio",
      command: "uvx",
      args: ["tool"],
      env: { MODE: "fast", API_KEY: "${HOST_KEY}" },
    })
    expect(
      buildClaudeMcpEntryFromSpec({ transport: "stdio", command: "x", args: [], env: {} })
    ).toEqual({ type: "stdio", command: "x", args: [] })
  })

  it("every entry it writes reads back as the spec it came from", () => {
    const specs: McpSpec[] = [
      { transport: "http", url: "https://x/mcp", headers: {}, bearerTokenEnvVar: "X_KEY" },
      { transport: "sse", url: "https://x/sse", headers: { "X-Org": "a" } },
      {
        transport: "stdio",
        command: "npx",
        args: ["-y", "pkg"],
        env: { A: "1" },
        envRefs: { B: "B_HOST" },
      },
    ]
    for (const spec of specs) {
      const json = mergeClaudeMcp("", "srv", buildClaudeMcpEntryFromSpec(spec))
      expect(parseClaudeMcpEntry(json, "srv")).toEqual(spec)
    }
  })

  it("mergeClaudeMcp overwrites one id in place and keeps the rest of the file", () => {
    const json = JSON.stringify({ numStartups: 3, mcpServers: { a: { command: "old" }, b: {} } })
    expect(JSON.parse(mergeClaudeMcp(json, "a", { command: "new" }))).toEqual({
      numStartups: 3,
      mcpServers: { a: { command: "new" }, b: {} },
    })
    expect(parseClaudeMcpEntry(json, "missing")).toBeUndefined()
    expect(parseClaudeMcpEntry('{"mcpServers":[]}', "a")).toBeUndefined()
  })

  it("removeClaudeMcp drops one server, and leaves other state or an empty file alone", () => {
    const json = JSON.stringify({ numStartups: 3, mcpServers: { a: {}, b: {} } })
    expect(JSON.parse(removeClaudeMcp(json, "a"))).toEqual({
      numStartups: 3,
      mcpServers: { b: {} },
    })
    expect(JSON.parse(removeClaudeMcp(json, "zzz"))).toEqual(JSON.parse(json))
    expect(JSON.parse(removeClaudeMcp('{"numStartups":1}', "a"))).toEqual({ numStartups: 1 })
    expect(removeClaudeMcp("   ", "a")).toBe("{}\n")
  })
})

describe("opencode.json guards", () => {
  it.each(["[]", "null", "3", '"str"'])(
    "refuses to merge into %s rather than clobber it",
    (text) => {
      expect(() => mergeOpencodeMcp(text, "x", { type: "local", command: ["x"] })).toThrow(
        /not a JSON object/
      )
    }
  )

  it("delete treats a non-object mcp value as nothing to remove and prunes it", () => {
    expect(JSON.parse(deleteOpencodeMcpEntry('{"mcp":[1],"theme":"x"}', "a"))).toEqual({
      theme: "x",
    })
  })

  it("setOpencodeMcpEnabled is a no-op for an absent id or a missing mcp object", () => {
    const text = '{"mcp":{"a":{"type":"local","command":["x"]}}}'
    expect(setOpencodeMcpEnabled(text, "b", false)).toBe(text)
    expect(setOpencodeMcpEnabled('{"theme":"x"}', "a", false)).toBe('{"theme":"x"}')
    expect(setOpencodeMcpEnabled("", "a", false)).toBe("")
  })
})

describe("reverse parsers on loose input", () => {
  it("reads Codex env_vars written as strings or as { name } tables", () => {
    const toml = [
      "[mcp_servers.x]",
      'command = "npx"',
      'args = ["-y", "pkg", 3]',
      'env_vars = ["A", { name = "B" }, { other = "C" }, 4]',
      "",
    ].join("\n")
    expect(parseCodexMcpEntry(toml, "x")).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "pkg"],
      env: {},
      envRefs: { A: "A", B: "B" },
    })
  })

  it("reads a Codex http entry with no bearer var, and rejects one with neither shape", () => {
    expect(parseCodexMcpEntry('[mcp_servers.x]\nurl = "https://x"\n', "x")).toEqual({
      transport: "http",
      url: "https://x",
      headers: {},
      bearerTokenEnvVar: undefined,
    })
    expect(
      parseCodexMcpEntry('[mcp_servers.x]\nurl = "https://x"\nbearer_token_env_var = 1\n', "x")
    ).toMatchObject({ bearerTokenEnvVar: undefined })
    expect(parseCodexMcpEntry("[mcp_servers.x]\nenabled = false\n", "x")).toBeUndefined()
    expect(parseCodexMcpEntry("[[broken", "x")).toBeUndefined()
  })

  it("reads a Claude http entry declared by type alone, with an empty url", () => {
    expect(specFromClaudeRecord({ type: "http" })).toEqual({
      transport: "http",
      url: "",
      headers: {},
    })
    expect(specFromClaudeRecord({ args: ["x"] })).toBeUndefined()
  })

  it("reads an OpenCode remote entry, lifting a {env:VAR} bearer into a reference", () => {
    expect(
      specFromOpencodeRecord({
        type: "remote",
        url: "https://x/mcp",
        headers: { Authorization: "Bearer {env:X_KEY}", "X-Org": "a", Bad: 1 },
      })
    ).toEqual({
      transport: "http",
      url: "https://x/mcp",
      headers: { "X-Org": "a" },
      bearerTokenEnvVar: "X_KEY",
    })
  })

  it("keeps a literal OpenCode bearer token as a header, and infers remote from a url", () => {
    expect(
      specFromOpencodeRecord({ url: "https://x", headers: { Authorization: "Bearer sk-lit" } })
    ).toEqual({ transport: "http", url: "https://x", headers: { Authorization: "Bearer sk-lit" } })
    expect(specFromOpencodeRecord({ type: "remote" })).toEqual({
      transport: "http",
      url: "",
      headers: {},
    })
  })

  it("rejects an OpenCode local entry with no command, and splits env refs from literals", () => {
    expect(specFromOpencodeRecord({ type: "local", command: [] })).toBeUndefined()
    expect(specFromOpencodeRecord({ type: "local", command: "npx" })).toBeUndefined()
    expect(
      specFromOpencodeRecord({
        type: "local",
        command: ["uvx", "tool"],
        environment: { KEY: "{env:HOST}", MODE: "fast" },
      })
    ).toEqual({
      transport: "stdio",
      command: "uvx",
      args: ["tool"],
      env: { MODE: "fast" },
      envRefs: { KEY: "HOST" },
    })
  })

  it("parseOpencodeMcpEntry returns undefined for malformed JSON or a missing entry", () => {
    expect(parseOpencodeMcpEntry("{nope", "x")).toBeUndefined()
    expect(parseOpencodeMcpEntry('{"mcp":{"x":"str"}}', "x")).toBeUndefined()
  })
})
