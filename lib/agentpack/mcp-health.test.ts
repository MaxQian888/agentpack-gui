import { checkSpecHealth, httpTarget, type HealthProbes } from "./mcp-health"
import type { McpSpec } from "./merge/mcp"

const stdio = (command: string): McpSpec => ({ transport: "stdio", command, args: [], env: {} })
const http = (url: string): McpSpec => ({ transport: "http", url, headers: {} })
const sse = (url: string): McpSpec => ({ transport: "sse", url, headers: {} })

function probes(over: Partial<HealthProbes> = {}): HealthProbes {
  return {
    commandOnPath: jest.fn(async () => true),
    probeHost: jest.fn(async () => ({ reachable: true, latencyMs: 12 })),
    ...over,
  }
}

describe("httpTarget", () => {
  it("defaults the port from the scheme", () => {
    expect(httpTarget(http("https://mcp.example.com/mcp"))).toEqual({
      host: "mcp.example.com",
      port: 443,
    })
    expect(httpTarget(http("http://mcp.example.com/mcp"))).toEqual({
      host: "mcp.example.com",
      port: 80,
    })
  })

  it("honors an explicit port", () => {
    expect(httpTarget(http("http://localhost:8080/sse"))).toEqual({ host: "localhost", port: 8080 })
  })

  it("returns null for a bad url or a stdio spec", () => {
    expect(httpTarget(http("not a url"))).toBeNull()
    expect(httpTarget(stdio("npx"))).toBeNull()
  })

  it("resolves an sse spec like any other remote one", () => {
    // Returning null here failed every SSE server with "Invalid server URL".
    expect(httpTarget(sse("https://mcp.example.com/sse"))).toEqual({
      host: "mcp.example.com",
      port: 443,
    })
  })
})

describe("checkSpecHealth", () => {
  it("passes a stdio server whose command is on PATH", async () => {
    const p = probes({ commandOnPath: jest.fn(async () => true) })
    expect(await checkSpecHealth(stdio("npx"), p)).toEqual({ status: "ok", reason: "cmd-ok" })
    expect(p.commandOnPath).toHaveBeenCalledWith("npx")
  })

  it("fails a stdio server whose command is missing", async () => {
    const p = probes({ commandOnPath: jest.fn(async () => false) })
    expect(await checkSpecHealth(stdio("nope"), p)).toEqual({
      status: "fail",
      reason: "cmd-missing",
    })
  })

  it("treats a probe rejection as a failure, not a throw", async () => {
    const p = probes({
      commandOnPath: jest.fn(async () => {
        throw new Error("boom")
      }),
    })
    expect(await checkSpecHealth(stdio("npx"), p)).toEqual({
      status: "fail",
      reason: "cmd-missing",
    })
  })

  it("passes a reachable http endpoint and records latency", async () => {
    const p = probes({ probeHost: jest.fn(async () => ({ reachable: true, latencyMs: 34 })) })
    expect(await checkSpecHealth(http("https://mcp.example.com/mcp"), p)).toEqual({
      status: "ok",
      reason: "http-ok",
      latencyMs: 34,
    })
    expect(p.probeHost).toHaveBeenCalledWith("mcp.example.com", 443)
  })

  it("fails an unreachable http endpoint", async () => {
    const p = probes({ probeHost: jest.fn(async () => ({ reachable: false, latencyMs: null })) })
    expect(await checkSpecHealth(http("https://down.example.com"), p)).toEqual({
      status: "fail",
      reason: "http-unreachable",
    })
  })

  it("probes a reachable sse endpoint instead of calling its url invalid", async () => {
    const p = probes({ probeHost: jest.fn(async () => ({ reachable: true, latencyMs: 8 })) })
    expect(await checkSpecHealth(sse("http://localhost:8080/sse"), p)).toEqual({
      status: "ok",
      reason: "http-ok",
      latencyMs: 8,
    })
    expect(p.probeHost).toHaveBeenCalledWith("localhost", 8080)
  })

  it("fails a malformed url without probing", async () => {
    const p = probes()
    expect(await checkSpecHealth(http("::::"), p)).toEqual({ status: "fail", reason: "bad-url" })
    expect(p.probeHost).not.toHaveBeenCalled()
  })
})
