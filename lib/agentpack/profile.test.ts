import {
  emptyProfileStore,
  parseProfiles,
  profilesPath,
  serializeProfiles,
  type Profile,
} from "./profile"
import type { Plan } from "./types"

const plan: Plan = {
  os: "mac",
  clis: ["claude-code"],
  skills: [{ id: "rust", targets: ["claude"] }],
  mcps: [{ id: "memory", targets: ["claude"] }],
  mcpKeys: { context7: "secret" },
  network: { npmRegistry: "https://m" },
}

const profile: Profile = { id: "p1", name: "Work", createdAt: 123, plan }

it("serialize → parse round-trips a profile with secrets intact", () => {
  const store = { version: 1 as const, profiles: [profile] }
  const out = parseProfiles(serializeProfiles(store))
  expect(out.profiles).toHaveLength(1)
  expect(out.profiles[0].plan.mcpKeys.context7).toBe("secret")
  expect(out.profiles[0].plan.network.npmRegistry).toBe("https://m")
})

it("parseProfiles strips relay fields from a profile saved before providers", () => {
  // Applying such a profile must not re-introduce a second writer for the agent
  // CLIs' endpoint — that config is owned by the provider list now.
  const json = JSON.stringify({
    profiles: [
      {
        id: "p1",
        name: "Work",
        plan: {
          ...plan,
          network: { npmRegistry: "https://m", apiBaseUrl: "https://r", apiToken: "t" },
        },
      },
    ],
  })
  const net = parseProfiles(json).profiles[0].plan.network as Record<string, unknown>
  expect(net["npmRegistry"]).toBe("https://m")
  expect(net["apiBaseUrl"]).toBeUndefined()
  expect(net["apiToken"]).toBeUndefined()
})

it("parseProfiles degrades to empty store on invalid / empty input", () => {
  expect(parseProfiles("")).toEqual(emptyProfileStore())
  expect(parseProfiles("{not json")).toEqual(emptyProfileStore())
  expect(parseProfiles(JSON.stringify({ nope: true }))).toEqual(emptyProfileStore())
})

it("parseProfiles drops entries missing id / name / plan", () => {
  const json = JSON.stringify({
    profiles: [{ id: "ok", name: "Ok", plan: {} }, { name: "no-id", plan: {} }, { id: "no-plan" }],
  })
  const out = parseProfiles(json)
  expect(out.profiles.map((p) => p.id)).toEqual(["ok"])
})

it("profilesPath nests under ~/.agentpack", () => {
  expect(profilesPath("/home/me")).toBe("/home/me/.agentpack/profiles.json")
})
