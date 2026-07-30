import { parseDoc, pickClaudeConfigSubset, redactFileText, restoreBlankedSecrets } from "./secrets"

const CLAUDE_SETTINGS = JSON.stringify({
  model: "opus",
  env: { ANTHROPIC_AUTH_TOKEN: "sk-live-abc", HTTP_PROXY: "http://p:8080" },
  permissions: { allow: ["Bash(ls)"], deny: [] },
  hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }] },
  mcpServers: { corp: { url: "https://x", headers: { Authorization: "Bearer live-xyz" } } },
})

const CODEX_TOML = [
  'model = "gpt-5"',
  'approval_policy = "on-request"',
  "",
  "[model_providers.custom]",
  'experimental_bearer_token = "live-codex"',
  "",
  "[mcp_servers.y.env]",
  'SOME_API_KEY = "live-mcp"',
  'PLAIN_SETTING = "keepme"',
  "",
].join("\n")

describe("redactFileText", () => {
  it("blanks a token nested anywhere, not just the well-known names", () => {
    const doc = parseDoc("claudeSettings", redactFileText("claudeSettings", CLAUDE_SETTINGS)!)!
    const env = doc.env as Record<string, string>
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("")
    const servers = doc.mcpServers as Record<string, { headers: Record<string, string> }>
    expect(servers.corp.headers.Authorization).toBe("")
  })

  it("leaves non-secret values untouched", () => {
    const doc = parseDoc("claudeSettings", redactFileText("claudeSettings", CLAUDE_SETTINGS)!)!
    expect(doc.model).toBe("opus")
    expect(doc.permissions).toEqual({ allow: ["Bash(ls)"], deny: [] })
    expect(doc.hooks).toEqual(JSON.parse(CLAUDE_SETTINGS).hooks)
    expect((doc.env as Record<string, string>).HTTP_PROXY).toBe("http://p:8080")
  })

  it("blanks both of codex's token locations and keeps the rest", () => {
    const doc = parseDoc("codexConfig", redactFileText("codexConfig", CODEX_TOML)!)!
    const providers = doc.model_providers as Record<string, Record<string, string>>
    expect(providers.custom.experimental_bearer_token).toBe("")
    const servers = doc.mcp_servers as Record<string, { env: Record<string, string> }>
    expect(servers.y.env.SOME_API_KEY).toBe("")
    expect(servers.y.env.PLAIN_SETTING).toBe("keepme")
    expect(doc.model).toBe("gpt-5")
    expect(doc.approval_policy).toBe("on-request")
  })

  it("drops a file it cannot parse rather than shipping uninspected bytes", () => {
    expect(redactFileText("codexConfig", "not [ toml")).toBeNull()
    expect(redactFileText("claudeSettings", "{ broken")).toBeNull()
  })

  it("blanks string elements of an array under a secret key", () => {
    const text = JSON.stringify({ tokens: ["a", "b"], names: ["x"] })
    const doc = parseDoc("claudeSettings", redactFileText("claudeSettings", text)!)!
    expect(doc.tokens).toEqual(["", ""])
    expect(doc.names).toEqual(["x"])
  })
})

describe("restoreBlankedSecrets", () => {
  const redacted = redactFileText("claudeSettings", CLAUDE_SETTINGS)!

  it("puts the local machine's credential back where the bundle blanked one", () => {
    const local = JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: "sk-mine" } })
    const merged = parseDoc(
      "claudeSettings",
      restoreBlankedSecrets("claudeSettings", redacted, local)
    )!
    expect((merged.env as Record<string, string>).ANTHROPIC_AUTH_TOKEN).toBe("sk-mine")
    // The structural half still comes from the bundle.
    expect(merged.model).toBe("opus")
  })

  it("leaves the blank when the local machine has nothing either", () => {
    const local = JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: "" } })
    const merged = parseDoc(
      "claudeSettings",
      restoreBlankedSecrets("claudeSettings", redacted, local)
    )!
    expect((merged.env as Record<string, string>).ANTHROPIC_AUTH_TOKEN).toBe("")
  })

  it("keeps a non-blank incoming secret — that was a deliberate export", () => {
    const local = JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: "sk-mine" } })
    const merged = parseDoc(
      "claudeSettings",
      restoreBlankedSecrets("claudeSettings", CLAUDE_SETTINGS, local)
    )!
    expect((merged.env as Record<string, string>).ANTHROPIC_AUTH_TOKEN).toBe("sk-live-abc")
  })

  it("always takes the incoming value for a non-secret key", () => {
    const local = JSON.stringify({ model: "sonnet", env: { ANTHROPIC_AUTH_TOKEN: "sk-mine" } })
    const merged = parseDoc(
      "claudeSettings",
      restoreBlankedSecrets("claudeSettings", redacted, local)
    )!
    expect(merged.model).toBe("opus")
  })

  it("returns the incoming text verbatim when nothing needed restoring", () => {
    expect(restoreBlankedSecrets("codexConfig", CODEX_TOML, "")).toBe(CODEX_TOML)
    expect(restoreBlankedSecrets("codexConfig", CODEX_TOML, 'model = "old"\n')).toBe(CODEX_TOML)
  })

  it("throws rather than blank a local file it cannot parse", () => {
    expect(() => restoreBlankedSecrets("claudeSettings", redacted, "{ broken")).toThrow(
      /could not be parsed/
    )
  })

  it("restores a codex bearer token through TOML", () => {
    const redactedToml = redactFileText("codexConfig", CODEX_TOML)!
    const local = '[model_providers.custom]\nexperimental_bearer_token = "mine"\n'
    const merged = parseDoc(
      "codexConfig",
      restoreBlankedSecrets("codexConfig", redactedToml, local)
    )!
    const providers = merged.model_providers as Record<string, Record<string, string>>
    expect(providers.custom.experimental_bearer_token).toBe("mine")
  })
})

describe("pickClaudeConfigSubset", () => {
  it("keeps mcpServers and drops the CLI's session state", () => {
    const text = JSON.stringify({
      mcpServers: { memory: { command: "npx" } },
      projects: { "/repo": { history: ["secret prompt"] } },
      oauthAccount: { emailAddress: "a@b.c" },
      userID: "u1",
    })
    const out = JSON.parse(pickClaudeConfigSubset(text)!)
    expect(out).toEqual({ mcpServers: { memory: { command: "npx" } } })
  })

  it("returns null when there is nothing worth carrying", () => {
    expect(pickClaudeConfigSubset(JSON.stringify({ projects: {} }))).toBeNull()
    expect(pickClaudeConfigSubset(JSON.stringify({ mcpServers: {} }))).toBeNull()
    expect(pickClaudeConfigSubset("{ broken")).toBeNull()
  })
})
