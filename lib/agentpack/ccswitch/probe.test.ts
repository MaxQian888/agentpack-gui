import { modelsUrl, probeRequest, readProbe } from "./probe"

it("appends /v1/models to a bare root but only /models to a versioned base", () => {
  // Claude base URLs are the bare root; codex ones already carry /v1. Appending
  // blindly gives /v1/v1/models or a 404 depending on the app.
  expect(modelsUrl("https://api.anthropic.com")).toBe("https://api.anthropic.com/v1/models")
  expect(modelsUrl("https://relay.example/v1")).toBe("https://relay.example/v1/models")
  expect(modelsUrl("https://relay.example/v1/")).toBe("https://relay.example/v1/models")
  expect(modelsUrl("  https://relay.example  ")).toBe("https://relay.example/v1/models")
})

it("sends the auth header the CLI itself would send", () => {
  const apiKey = probeRequest({
    app: "claude",
    baseUrl: "https://r",
    token: "sk-1",
    claudeAuthKind: "api_key",
  })
  expect(apiKey?.headers["x-api-key"]).toBe("sk-1")
  expect(apiKey?.headers["Authorization"]).toBeUndefined()
  expect(apiKey?.headers["anthropic-version"]).toBeTruthy()

  const authToken = probeRequest({
    app: "claude",
    baseUrl: "https://r",
    token: "sk-1",
    claudeAuthKind: "auth_token",
  })
  expect(authToken?.headers["Authorization"]).toBe("Bearer sk-1")
  expect(authToken?.headers["x-api-key"]).toBeUndefined()

  const codex = probeRequest({
    app: "codex",
    baseUrl: "https://r/v1",
    token: "sk-1",
    claudeAuthKind: "auth_token",
  })
  expect(codex?.headers["Authorization"]).toBe("Bearer sk-1")
  expect(codex?.headers["anthropic-version"]).toBeUndefined()
})

it("has nothing to probe without a base URL", () => {
  expect(
    probeRequest({ app: "claude", baseUrl: "  ", token: "t", claudeAuthKind: "auth_token" })
  ).toBeNull()
})

it("omits the auth header entirely for an official-login provider", () => {
  const req = probeRequest({
    app: "claude",
    baseUrl: "https://api.anthropic.com",
    token: "",
    claudeAuthKind: "auth_token",
  })
  expect(req?.headers["Authorization"]).toBeUndefined()
  expect(req?.headers["x-api-key"]).toBeUndefined()
})

it("names the three failures that actually happen", () => {
  expect(readProbe({ status: 401 })).toMatchObject({ ok: false, reason: "unauthorized" })
  expect(readProbe({ status: 403 })).toMatchObject({ ok: false, reason: "unauthorized" })
  // The classic "base URL is missing its /v1".
  expect(readProbe({ status: 404 })).toMatchObject({ ok: false, reason: "not-found" })
  expect(readProbe({ status: null, error: "timeout" })).toMatchObject({
    ok: false,
    reason: "unreachable",
  })
  expect(readProbe({ status: 500 })).toMatchObject({ ok: false, reason: "http-error" })
})

it("reads model ids out of either API's list shape", () => {
  const openai = readProbe({
    status: 200,
    latencyMs: 412,
    body: JSON.stringify({ data: [{ id: "gpt-5.2" }, { id: "gpt-5.5" }] }),
  })
  expect(openai).toMatchObject({ ok: true, latencyMs: 412 })
  expect(openai.models).toEqual(["gpt-5.2", "gpt-5.5"])

  const anthropic = readProbe({
    status: 200,
    body: JSON.stringify({ models: ["claude-sonnet-5"] }),
  })
  expect(anthropic.models).toEqual(["claude-sonnet-5"])
})

it("still reports success when the body isn't a model list", () => {
  // Plenty of relays answer 200 with something unexpected; reachability and auth
  // are still proven, so the check must not read as a failure.
  const out = readProbe({ status: 200, body: "not json" })
  expect(out.ok).toBe(true)
  expect(out.models).toEqual([])
})
