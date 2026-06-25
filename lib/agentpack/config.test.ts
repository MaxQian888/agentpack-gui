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
