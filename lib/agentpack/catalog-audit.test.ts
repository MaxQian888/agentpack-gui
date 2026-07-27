import {
  collectAuditTargets,
  describeHealth,
  isUnhealthy,
  isUrlBroken,
  parsePackageHealth,
} from "./catalog-audit"

describe("parsePackageHealth", () => {
  it("reports a 404 as not existing", () => {
    // The real regression: `@modelcontextprotocol/server-fetch` 404s on npm.
    const h = parsePackageHealth("@modelcontextprotocol/server-fetch", 404, null)
    expect(h).toEqual({
      name: "@modelcontextprotocol/server-fetch",
      exists: false,
      deprecated: false,
    })
    expect(isUnhealthy(h)).toBe(true)
  })

  it("reports npm's deprecation message", () => {
    const h = parsePackageHealth("@modelcontextprotocol/server-github", 200, {
      version: "2025.4.8",
      deprecated: "Package no longer supported. Contact Support at https://www.npmjs.com/support",
    })
    expect(h.exists).toBe(true)
    expect(h.deprecated).toBe(true)
    expect(h.message).toContain("no longer supported")
    expect(h.latest).toBe("2025.4.8")
    expect(isUnhealthy(h)).toBe(true)
  })

  it("passes a healthy package and surfaces its latest version", () => {
    const h = parsePackageHealth("@anthropic-ai/claude-code", 200, { version: "2.1.220" })
    expect(isUnhealthy(h)).toBe(false)
    expect(h.latest).toBe("2.1.220")
  })

  it("treats an empty deprecated string as not deprecated", () => {
    // Some manifests carry `deprecated: ""`, which npm does not render as a warning.
    expect(parsePackageHealth("x", 200, { version: "1.0.0", deprecated: "  " }).deprecated).toBe(
      false
    )
  })

  it("does not claim a package is gone when the registry is flaky", () => {
    // A 500 or an unreadable body must not be reported as "package deleted",
    // or a bad registry day would open a false alarm every week.
    for (const [status, body] of [
      [500, null],
      [503, { version: "1.0.0" }],
      [200, null],
    ] as const) {
      const h = parsePackageHealth("x", status, body)
      expect(h.exists).toBe(true)
      expect(isUnhealthy(h)).toBe(false)
    }
  })
})

describe("describeHealth", () => {
  it("explains each verdict in one line", () => {
    expect(describeHealth(parsePackageHealth("a", 404, null))).toContain("does not exist")
    expect(describeHealth(parsePackageHealth("b", 200, { deprecated: "gone" }))).toContain(
      "deprecated"
    )
    expect(describeHealth(parsePackageHealth("c", 200, { version: "1.2.3" }))).toContain("1.2.3")
  })
})

describe("isUrlBroken", () => {
  it("flags only gone-for-good statuses", () => {
    expect(isUrlBroken(404)).toBe(true)
    expect(isUrlBroken(410)).toBe(true)
  })

  it("accepts auth-gated and method-restricted endpoints as reachable", () => {
    // api.githubcopilot.com/mcp/ answers 401 to an unauthenticated probe; that is
    // the endpoint working, not the catalog being wrong.
    for (const status of [200, 204, 301, 302, 401, 403, 405]) {
      expect(isUrlBroken(status)).toBe(false)
    }
  })

  it("does not blame the catalog for an upstream outage", () => {
    for (const status of [500, 502, 503]) expect(isUrlBroken(status)).toBe(false)
  })
})

describe("collectAuditTargets", () => {
  const targets = collectAuditTargets()
  const npm = targets.filter((t) => t.kind === "npm").map((t) => t.value)
  const urls = targets.filter((t) => t.kind === "url").map((t) => t.value)

  it("covers the npm-installed CLIs", () => {
    expect(npm).toContain("@anthropic-ai/claude-code")
    expect(npm).toContain("@openai/codex")
  })

  it("extracts installer URLs out of shell command strings", () => {
    // These live inside `bash -c "curl -fsSL <url> | bash"`, not as their own field.
    expect(urls).toContain("https://claude.ai/install.sh")
    expect(urls).toContain("https://bun.com/install")
    expect(urls.some((u) => u.includes("astral.sh/uv"))).toBe(true)
  })

  it("checks a remote MCP endpoint", () => {
    expect(urls).toContain("https://api.githubcopilot.com/mcp/")
  })

  it("audits a uvx server against PyPI, not npm", () => {
    // `mcp-server-fetch` is a PyPI package; checking it on npm would report a
    // false 404 — the very failure mode this audit exists to catch. Skipping it
    // outright would leave that same spot unwatched, so it must land under pypi.
    expect(npm).not.toContain("mcp-server-fetch")
    const pypi = targets.filter((t) => t.kind === "pypi").map((t) => t.value)
    expect(pypi).toContain("mcp-server-fetch")
  })

  it("de-duplicates targets shared across operating systems", () => {
    expect(new Set(targets.map((t) => `${t.kind}:${t.value}`)).size).toBe(targets.length)
  })

  it("tags every target with the catalog entry it came from", () => {
    for (const t of targets) expect(t.source).toMatch(/^(cli|runtime|mcp):/)
  })
})
