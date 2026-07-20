import {
  deriveRegistryId,
  mapRegistryResponse,
  mapRegistryServer,
  type RegistryListResponse,
  type RegistryServer,
} from "./registry-remote"

describe("deriveRegistryId", () => {
  it("uses the last path segment when it's meaningful", () => {
    expect(deriveRegistryId("io.github.Digital-Defiance/mcp-filesystem")).toBe("mcp-filesystem")
    expect(deriveRegistryId("com.pulsemcp/remote-filesystem")).toBe("remote-filesystem")
  })
  it("falls back to the namespace when the tail is generic", () => {
    const id = deriveRegistryId("ac.inference.sh/mcp")
    expect(id).toMatch(/^[a-z0-9-]+$/)
    expect(id).not.toBe("mcp")
    expect(id.length).toBeGreaterThan(0)
  })
  it("always yields a valid, non-empty slug", () => {
    expect(deriveRegistryId("")).toMatch(/^[a-z0-9-]+$/)
    expect(deriveRegistryId("Weird Name!!")).toMatch(/^[a-z0-9-]+$/)
  })
})

describe("mapRegistryServer", () => {
  it("maps an npm stdio package with secret + default env vars", () => {
    const server: RegistryServer = {
      name: "com.pulsemcp/remote-filesystem",
      description: "Remote filesystem",
      version: "0.1.5",
      repository: { url: "https://github.com/pulsemcp/mcp-servers" },
      packages: [
        {
          registryType: "npm",
          identifier: "remote-filesystem-mcp-server",
          version: "0.1.5",
          runtimeHint: "npx",
          transport: { type: "stdio" },
          runtimeArguments: [{ value: "-y", type: "positional" }],
          environmentVariables: [
            { name: "GCS_BUCKET", isRequired: true },
            { name: "GCS_PRIVATE_KEY", isSecret: true },
            { name: "GCS_MAKE_PUBLIC", default: "false" },
          ],
        },
      ],
    }
    const c = mapRegistryServer(server)
    expect(c.id).toBe("remote-filesystem")
    expect(c.docsUrl).toBe("https://github.com/pulsemcp/mcp-servers")
    expect(c.spec).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "remote-filesystem-mcp-server@0.1.5"],
      env: { GCS_MAKE_PUBLIC: "false" }, // default inlined
      envRefs: { GCS_PRIVATE_KEY: "GCS_PRIVATE_KEY" }, // secret referenced, never inlined
    })
    // Every env var surfaces to the form, flagged.
    expect(c.envInputs).toEqual([
      {
        name: "GCS_BUCKET",
        description: undefined,
        required: true,
        secret: false,
        default: undefined,
      },
      {
        name: "GCS_PRIVATE_KEY",
        description: undefined,
        required: false,
        secret: true,
        default: undefined,
      },
      {
        name: "GCS_MAKE_PUBLIC",
        description: undefined,
        required: false,
        secret: false,
        default: "false",
      },
    ])
  })

  it("maps a pypi package to a uvx command", () => {
    const c = mapRegistryServer({
      name: "io.example/py-tool",
      packages: [{ registryType: "pypi", identifier: "py-tool", transport: { type: "stdio" } }],
    })
    expect(c.spec).toEqual({ transport: "stdio", command: "uvx", args: ["py-tool"], env: {} })
  })

  it("prefers npm over pypi when both are offered", () => {
    const c = mapRegistryServer({
      name: "io.example/dual",
      packages: [
        { registryType: "pypi", identifier: "dual-py", transport: { type: "stdio" } },
        { registryType: "npm", identifier: "dual-js", transport: { type: "stdio" } },
      ],
    })
    expect(c.spec?.transport).toBe("stdio")
    expect((c.spec as { command: string }).command).toBe("npx")
  })

  it("maps a streamable-http remote to an http spec", () => {
    const c = mapRegistryServer({
      name: "ac.inference.sh/mcp",
      remotes: [{ type: "streamable-http", url: "https://api.inference.sh/mcp" }],
    })
    expect(c.spec).toEqual({ transport: "http", url: "https://api.inference.sh/mcp", headers: {} })
  })

  it("maps an sse remote to an sse spec and prefers streamable-http when both exist", () => {
    const sseOnly = mapRegistryServer({
      name: "io.example/sse",
      remotes: [{ type: "sse", url: "https://x/sse" }],
    })
    expect(sseOnly.spec?.transport).toBe("sse")

    const both = mapRegistryServer({
      name: "io.example/both",
      remotes: [
        { type: "sse", url: "https://x/sse" },
        { type: "streamable-http", url: "https://x/mcp" },
      ],
    })
    expect(both.spec?.transport).toBe("http")
    expect((both.spec as { url: string }).url).toBe("https://x/mcp")
  })

  it("marks an OCI-only server unsupported with no spec", () => {
    const c = mapRegistryServer({
      name: "io.example/container",
      packages: [
        { registryType: "oci", identifier: "example/img:latest", transport: { type: "stdio" } },
      ],
    })
    expect(c.spec).toBeUndefined()
    expect(c.unsupported).toBe("oci")
  })

  it("marks a server with nothing installable as unsupported:none", () => {
    const c = mapRegistryServer({ name: "io.example/empty" })
    expect(c.spec).toBeUndefined()
    expect(c.unsupported).toBe("none")
  })

  it("is defensive against a malformed server", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = mapRegistryServer({} as any)
    expect(c.id).toMatch(/^[a-z0-9-]+$/)
    expect(c.unsupported).toBe("none")
  })
})

describe("mapRegistryResponse", () => {
  it("maps the /v0/servers envelope and carries the cursor", () => {
    const res: RegistryListResponse = {
      servers: [
        {
          server: {
            name: "io.example/a",
            packages: [{ registryType: "npm", identifier: "a", transport: { type: "stdio" } }],
          },
          _meta: {
            "io.modelcontextprotocol.registry/official": { isLatest: true, status: "active" },
          },
        },
        // A row missing its server object is dropped rather than crashing.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
      ],
      metadata: { nextCursor: "cur-1", count: 2 },
    }
    const { candidates, nextCursor } = mapRegistryResponse(res)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].id).toBe("a")
    expect(nextCursor).toBe("cur-1")
  })

  it("returns an empty list + no cursor for an empty response", () => {
    expect(mapRegistryResponse({})).toEqual({ candidates: [], nextCursor: undefined })
  })

  it("de-duplicates repeated names (multiple versions), keeping the first", () => {
    const row = (version: string) => ({
      server: {
        name: "io.example/dup",
        version,
        packages: [{ registryType: "npm", identifier: "dup", transport: { type: "stdio" } }],
      },
    })
    const { candidates } = mapRegistryResponse({ servers: [row("2.0.0"), row("1.0.0")] })
    expect(candidates).toHaveLength(1)
    expect(candidates[0].version).toBe("2.0.0")
  })
})
