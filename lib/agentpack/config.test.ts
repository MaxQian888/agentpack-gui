import { serializePlan, parseConfig, fillSecrets } from "./config"
import type { Plan } from "./types"

const plan: Plan = {
  os: "mac",
  clis: ["claude-code"],
  skills: [],
  mcps: [{ id: "context7", targets: ["claude"] }],
  mcpKeys: { context7: "secret" },
  network: { apiToken: "t" },
}

it("serialize redacts secrets and parse validates", () => {
  const json = serializePlan(plan)
  expect(json).not.toContain("secret")
  expect(JSON.parse(json).network.apiToken).toBeUndefined()
  const back = parseConfig(json)
  expect(back.clis).toEqual(["claude-code"])
  expect(back.mcps).toEqual([{ id: "context7", targets: ["claude"] }])
})

it("parse rejects unknown ids", () => {
  expect(() => parseConfig(JSON.stringify({ os: "mac", clis: ["nope"] }))).toThrow()
  expect(() => parseConfig("{ not json")).toThrow()
})

it("fillSecrets refills mcp keys + relay token from a map", () => {
  const redacted = parseConfig(serializePlan(plan))
  const filled = fillSecrets(redacted, { CONTEXT7_API_KEY: "k7", AGENTPACK_API_KEY: "relay" })
  expect(filled.mcpKeys.context7).toBe("k7")
  expect(filled.network.apiToken).toBe("relay")
})

it("serialize keeps secrets when includeSecrets is set", () => {
  const json = serializePlan(plan, { includeSecrets: true })
  expect(JSON.parse(json).network.apiToken).toBe("t")
  expect(JSON.parse(json).mcpKeys.context7).toBe("secret")
})

it("parse rejects an unknown OS", () => {
  expect(() => parseConfig(JSON.stringify({ os: "solaris" }))).toThrow(/solaris/)
})

it("parse rejects unknown skills and mcps", () => {
  expect(() =>
    parseConfig(JSON.stringify({ os: "mac", skills: [{ id: "ghost", targets: [] }] }))
  ).toThrow(/ghost/)
  expect(() =>
    parseConfig(JSON.stringify({ os: "mac", mcps: [{ id: "ghost", targets: [] }] }))
  ).toThrow(/ghost/)
})

it("parse tolerates missing/invalid arrays and objects", () => {
  const back = parseConfig(JSON.stringify({ os: "linux", clis: "nope", mcpKeys: 5, network: 7 }))
  expect(back).toEqual({
    os: "linux",
    clis: [],
    skills: [],
    mcps: [],
    mcpKeys: {},
    network: {},
  })
})

it("serialize + parse round-trips the chosen install method", () => {
  const p: Plan = { ...plan, cliMethods: { "claude-code": "native" } }
  const back = parseConfig(serializePlan(p))
  expect(back.cliMethods).toEqual({ "claude-code": "native" })
})

it("parse rejects an unknown install method or a method on an unknown cli", () => {
  expect(() =>
    parseConfig(
      JSON.stringify({ os: "mac", clis: ["claude-code"], cliMethods: { "claude-code": "ghost" } })
    )
  ).toThrow(/ghost/)
  expect(() => parseConfig(JSON.stringify({ os: "mac", cliMethods: { nope: "npm" } }))).toThrow(
    /nope/
  )
})

it("fillSecrets leaves the plan untouched when no secrets match", () => {
  const filled = fillSecrets(plan, {})
  expect(filled.mcpKeys.context7).toBe("secret")
  expect(filled.network.apiToken).toBe("t")
})
