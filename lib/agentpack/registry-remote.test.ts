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

describe("mapRegistryServer on loose registry data", () => {
  it("flattens named and positional arguments and skips empty or null ones", () => {
    const c = mapRegistryServer({
      name: "io.example/args",
      packages: [
        {
          registryType: "npm",
          identifier: "args-mcp",
          runtimeArguments: [
            { type: "positional", value: "-y" },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            null as any,
            { type: "named", name: "", value: "" },
          ],
          packageArguments: [
            { type: "named", name: "--port", value: "8080" },
            { type: "named", name: "--verbose" },
          ],
        },
      ],
    })
    expect(c.spec).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "args-mcp", "--port", "8080", "--verbose"],
      env: {},
    })
  })

  it("ignores env vars with no usable name, and never inlines a secret's default", () => {
    const c = mapRegistryServer({
      name: "io.example/env",
      packages: [
        {
          registryType: "npm",
          identifier: "env-mcp",
          environmentVariables: [
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            null as any,
            { description: "no name" },
            { name: "" },
            { name: "API_KEY", isSecret: true, default: "sk-planted" },
          ],
        },
      ],
    })
    expect(c.envInputs.map((i) => i.name)).toEqual(["API_KEY"])
    expect(c.spec).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["env-mcp"],
      env: {},
      envRefs: { API_KEY: "API_KEY" },
    })
    expect(JSON.stringify(c.spec)).not.toContain("sk-planted")
  })

  it("pins a scoped npm package's version without mistaking the scope for one", () => {
    const pinned = mapRegistryServer({
      name: "io.example/scoped",
      packages: [{ registryType: "npm", identifier: "@acme/mcp", version: "1.2.3" }],
    })
    expect((pinned.spec as { args: string[] }).args).toEqual(["@acme/mcp@1.2.3"])
    const already = mapRegistryServer({
      name: "io.example/scoped",
      packages: [{ registryType: "npm", identifier: "@acme/mcp@2.0.0", version: "1.2.3" }],
    })
    expect((already.spec as { args: string[] }).args).toEqual(["@acme/mcp@2.0.0"])
  })

  it("honours a runtime hint over the registry type's default", () => {
    const c = mapRegistryServer({
      name: "io.example/hinted",
      packages: [{ registryType: "pypi", identifier: "tool", runtimeHint: "pipx" }],
    })
    expect((c.spec as { command: string }).command).toBe("pipx")
  })

  it("skips packages with no type, no identifier, or an unknown runtime", () => {
    const c = mapRegistryServer({
      name: "io.example/skip",
      packages: [
        { identifier: "untyped" },
        { registryType: "npm" },
        { registryType: "nuget", identifier: "dotnet-tool" },
      ],
    })
    expect(c.spec).toBeUndefined()
    expect(c.unsupported).toBe("none")
  })

  it("carries non-secret remote headers and drops secret or malformed ones", () => {
    const c = mapRegistryServer({
      name: "io.example/remote",
      remotes: [
        {
          type: "streamable-http",
          url: "https://x/mcp",
          headers: [
            { name: "X-Org", value: "acme" },
            { name: "Authorization", value: "Bearer sk-planted", isSecret: true },
            { name: "X-Empty" },
            { value: "orphan" },
          ],
        },
      ],
    })
    expect(c.spec).toEqual({
      transport: "http",
      url: "https://x/mcp",
      headers: { "X-Org": "acme" },
    })
  })

  it("prefers streamable-http whichever order the remotes arrive in, and skips url-less ones", () => {
    for (const remotes of [
      [
        { type: "streamable-http", url: "https://x/mcp" },
        { type: "sse", url: "https://x/sse" },
      ],
      [
        { type: "sse", url: "https://x/sse" },
        { type: "sse", url: "https://x/sse2" },
        { type: "streamable-http", url: "" },
        { type: "streamable-http", url: "https://x/mcp" },
      ],
    ]) {
      const c = mapRegistryServer({ name: "io.example/order", remotes })
      expect(c.spec).toEqual({ transport: "http", url: "https://x/mcp", headers: {} })
    }
  })

  it("titles a server by its name when the name has no usable last segment", () => {
    expect(mapRegistryServer({ name: "io.example/" }).title).toBe("io.example/")
    expect(mapRegistryServer({ name: "io.example/tool", title: "Tool" }).title).toBe("Tool")
  })
})

describe("deriveRegistryId fallbacks", () => {
  it("joins the namespace's last label with a generic tail it would otherwise drop", () => {
    expect(deriveRegistryId("io.github.acme/server")).toBe("acme")
    expect(deriveRegistryId("io.github.acme/mcp/extra")).toBe("mcp-extra")
  })

  it("falls back to the whole name, then to a fixed id, when every part is generic", () => {
    expect(deriveRegistryId("mcp/server")).toBe("mcp-server")
    expect(deriveRegistryId("!!!/???")).toBe("mcp-server")
  })
})

describe("mapRegistryResponse defensiveness", () => {
  it("drops rows whose server has no string name and treats an empty cursor as none", () => {
    const { candidates, nextCursor } = mapRegistryResponse({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      servers: [null as any, { server: { name: 7 } } as any, { server: { name: "io.x/ok" } }],
      metadata: { nextCursor: "" },
    })
    expect(candidates.map((c) => c.name)).toEqual(["io.x/ok"])
    expect(nextCursor).toBeUndefined()
  })
})
