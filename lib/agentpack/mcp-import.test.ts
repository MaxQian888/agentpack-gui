import { exportMcpServers, parseMcpImport, type ImportedServer } from "./mcp-import"
import type { McpSpec } from "./merge/mcp"

/** Narrow to the success branch and fetch a server by id. */
function servers(text: string): ImportedServer[] {
  const r = parseMcpImport(text)
  if ("error" in r) throw new Error(`expected servers, got error: ${r.error}`)
  return r.servers
}
function byId(text: string, id: string): ImportedServer {
  const s = servers(text).find((x) => x.id === id)
  if (!s) throw new Error(`no server ${id}`)
  return s
}

describe("parseMcpImport — JSON", () => {
  it("parses an mcpServers map (stdio + http)", () => {
    const text = JSON.stringify({
      mcpServers: {
        memory: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"], env: {} },
        remote: { url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer x" } },
      },
    })
    expect(servers(text)).toHaveLength(2)
    expect(byId(text, "memory").spec).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
      env: {},
    })
    expect(byId(text, "remote").spec).toEqual({
      transport: "http",
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer x" },
    })
  })

  it("parses an OpenCode `mcp` map (type/local command array + remote)", () => {
    const text = JSON.stringify({
      mcp: {
        fs: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-filesystem"] },
        api: { type: "remote", url: "https://api.example.com/mcp" },
      },
    })
    expect(byId(text, "fs").spec).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem"],
      env: {},
    })
    expect(byId(text, "api").spec).toEqual({
      transport: "http",
      url: "https://api.example.com/mcp",
      headers: {},
    })
  })

  it("parses a single server object and derives an id from the package", () => {
    const s = servers(
      JSON.stringify({ command: "npx", args: ["-y", "@upstash/context7-mcp"], env: {} })
    )
    expect(s).toHaveLength(1)
    expect(s[0].id).toBe("context7-mcp")
    expect(s[0].spec.transport).toBe("stdio")
  })

  it("derives an id from the hostname for a single http object", () => {
    const s = servers(JSON.stringify({ url: "https://supermemory.ai/mcp" }))
    expect(s[0].id).toBe("supermemory")
    expect(s[0].spec.transport).toBe("http")
  })

  it("parses a bare id → entry map", () => {
    const s = servers(JSON.stringify({ myserver: { command: "uvx", args: ["thing"] } }))
    expect(s[0].id).toBe("myserver")
  })

  it("rejects valid JSON with no server entries", () => {
    expect(parseMcpImport("{}")).toEqual({ error: "unsupported" })
    expect(parseMcpImport("[1,2,3]")).toEqual({ error: "unsupported" })
  })
})

describe("parseMcpImport — claude mcp add command", () => {
  it("parses a stdio add with --scope, --env and a -- separator", () => {
    const s = servers(
      "claude mcp add memory --scope user --env API_KEY=abc -- npx -y @scope/pkg --flag"
    )
    expect(s[0]).toEqual({
      id: "memory",
      spec: {
        transport: "stdio",
        command: "npx",
        args: ["-y", "@scope/pkg", "--flag"],
        env: { API_KEY: "abc" },
      },
    })
  })

  it("parses an http add with a quoted --header", () => {
    const s = servers(
      'claude mcp add --transport http ctx https://ctx.example.com/mcp --header "Authorization: Bearer tok"'
    )
    expect(s[0]).toEqual({
      id: "ctx",
      spec: {
        transport: "http",
        url: "https://ctx.example.com/mcp",
        headers: { Authorization: "Bearer tok" },
      },
    })
  })

  it("parses a stdio add without the -- separator", () => {
    const s = servers("claude mcp add fetch npx -y @modelcontextprotocol/server-fetch")
    expect(s[0].spec).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-fetch"],
      env: {},
    })
  })
})

describe("parseMcpImport — errors", () => {
  it("reports empty input", () => {
    expect(parseMcpImport("   ")).toEqual({ error: "empty" })
  })

  it("reports unparseable input", () => {
    expect(parseMcpImport("this is not config")).toEqual({ error: "parse" })
    expect(parseMcpImport("{ broken json")).toEqual({ error: "parse" })
  })
})

describe("parseMcpImport — sse", () => {
  it("preserves sse from a `claude mcp add --transport sse` command", () => {
    const [srv] = servers("claude mcp add --transport sse asana https://mcp.asana.com/sse")
    expect(srv).toEqual({
      id: "asana",
      spec: { transport: "sse", url: "https://mcp.asana.com/sse", headers: {} },
    })
  })

  it("preserves sse from a pasted JSON mcpServers block", () => {
    const [srv] = servers(
      JSON.stringify({ mcpServers: { s: { type: "sse", url: "https://x/sse" } } })
    )
    expect(srv.spec.transport).toBe("sse")
  })
})

describe("exportMcpServers", () => {
  const stdio: McpSpec = {
    transport: "stdio",
    command: "npx",
    args: ["-y", "srv"],
    env: { PLAIN: "v" },
    envRefs: { API_KEY: "API_KEY" },
  }

  it("round-trips through parseMcpImport", () => {
    const json = exportMcpServers([{ id: "srv", spec: stdio }])
    const [srv] = servers(json)
    expect(srv).toEqual({ id: "srv", spec: stdio })
  })

  it("keeps env references but redacts literal secrets when asked", () => {
    const json = exportMcpServers([{ id: "srv", spec: stdio }], { redactSecrets: true })
    const parsed = JSON.parse(json)
    expect(parsed.mcpServers.srv.env).toEqual({ PLAIN: "<redacted>", API_KEY: "${API_KEY}" })
  })

  it("exports http/sse with a type and redacts the bearer token", () => {
    const http: McpSpec = {
      transport: "sse",
      url: "https://x/sse",
      headers: { Authorization: "Bearer secret" },
    }
    const parsed = JSON.parse(exportMcpServers([{ id: "h", spec: http }], { redactSecrets: true }))
    expect(parsed.mcpServers.h.type).toBe("sse")
    expect(parsed.mcpServers.h.headers.Authorization).toBe("Bearer <redacted>")
  })
})
