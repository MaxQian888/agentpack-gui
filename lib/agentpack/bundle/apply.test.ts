import type { Profile } from "../profile"
import type { Plan } from "../types"
import type { AppSettings } from "@/lib/tauri/settings"
import {
  describeSettingsChange,
  diffFiles,
  diffPlan,
  diffProfiles,
  diffSettings,
  keepLocalSecrets,
  keepLocalSettingsSecrets,
  mergePlan,
  mergeProfiles,
  retargetPlanOs,
} from "./apply"

const base: Plan = {
  os: "mac",
  clis: [],
  skills: [],
  mcps: [],
  mcpKeys: {},
  network: {},
}

const LOCAL: Plan = {
  ...base,
  clis: ["claude-code"],
  skills: [{ id: "rust", targets: ["claude"] }],
  mcps: [{ id: "context7", targets: ["claude"] }],
  mcpKeys: { context7: "local-key" },
  network: { proxy: { mode: "manual", targets: ["claude"], password: "local-pw" } },
}

const INCOMING: Plan = {
  ...base,
  clis: ["codex"],
  skills: [
    { id: "rust", targets: ["codex"] },
    { id: "python", targets: ["claude"] },
  ],
  mcps: [{ id: "memory", targets: ["opencode", "claude"] }],
  mcpKeys: {},
  network: { npmRegistry: "https://mirror/" },
}

describe("diffPlan", () => {
  it("reports removals in replace mode", () => {
    const d = diffPlan(LOCAL, INCOMING, "replace")
    expect(d.clis).toEqual({ added: ["codex"], removed: ["claude-code"] })
    expect(d.skills).toEqual({ added: ["python"], removed: [] })
    expect(d.mcps).toEqual({ added: ["memory"], removed: ["context7"] })
  })

  it("never reports a removal in merge mode", () => {
    const d = diffPlan(LOCAL, INCOMING, "merge")
    expect(d.clis).toEqual({ added: ["codex"], removed: [] })
    expect(d.mcps).toEqual({ added: ["memory"], removed: [] })
  })

  it("ignores a redacted password when deciding the network changed", () => {
    const redacted: Plan = {
      ...LOCAL,
      network: { proxy: { mode: "manual", targets: ["claude"], password: undefined } },
    }
    expect(diffPlan(LOCAL, redacted, "replace").networkChanged).toBe(false)
    expect(diffPlan(LOCAL, INCOMING, "replace").networkChanged).toBe(true)
  })
})

describe("mergePlan", () => {
  it("unions selections without dropping anything local", () => {
    const merged = mergePlan(LOCAL, INCOMING)
    expect(merged.clis).toEqual(["claude-code", "codex"])
    expect(merged.mcps.map((m) => m.id).sort()).toEqual(["context7", "memory"])
  })

  it("unions targets for an item both sides have, in canonical order", () => {
    const local: Plan = { ...base, mcps: [{ id: "memory", targets: ["opencode"] }] }
    const incoming: Plan = { ...base, mcps: [{ id: "memory", targets: ["codex", "claude"] }] }
    expect(mergePlan(local, incoming).mcps[0].targets).toEqual(["claude", "codex", "opencode"])
  })

  it("fills network fields only where the local plan had none", () => {
    const merged = mergePlan(LOCAL, INCOMING)
    expect(merged.network.npmRegistry).toBe("https://mirror/")
    expect(merged.network.proxy?.password).toBe("local-pw")
  })
})

describe("keepLocalSecrets", () => {
  it("restores an mcp key the export redacted, after either mode", () => {
    for (const next of [INCOMING, mergePlan(LOCAL, INCOMING)]) {
      expect(keepLocalSecrets(next, LOCAL).mcpKeys.context7).toBe("local-key")
    }
  })

  it("restores the proxy password", () => {
    const next: Plan = {
      ...INCOMING,
      network: { proxy: { mode: "manual", targets: ["claude"] } },
    }
    expect(keepLocalSecrets(next, LOCAL).network.proxy?.password).toBe("local-pw")
  })

  it("does not overwrite a secret the bundle actually carried", () => {
    const next: Plan = { ...INCOMING, mcpKeys: { context7: "from-bundle" } }
    expect(keepLocalSecrets(next, LOCAL).mcpKeys.context7).toBe("from-bundle")
  })
})

describe("retargetPlanOs", () => {
  it("returns the same plan when the OS already matches", () => {
    expect(retargetPlanOs(LOCAL, "mac")).toBe(LOCAL)
  })

  it("re-stamps the OS and drops a method the target OS does not offer", () => {
    const plan: Plan = {
      ...base,
      os: "win",
      clis: ["claude-code"],
      cliMethods: { "claude-code": "npm", codex: "winget" },
    }
    const out = retargetPlanOs(plan, "mac")
    expect(out.os).toBe("mac")
    expect(out.cliMethods).toHaveProperty("claude-code")
    expect(out.cliMethods).not.toHaveProperty("codex")
  })
})

describe("profiles", () => {
  const local: Profile[] = [{ id: "a", name: "Local", createdAt: 1, plan: base }]
  const incoming: Profile[] = [
    { id: "a", name: "Updated", createdAt: 2, plan: base },
    { id: "b", name: "New", createdAt: 3, plan: base },
  ]

  it("counts fresh and updated entries", () => {
    expect(diffProfiles(local, incoming)).toMatchObject({ fresh: 1, updated: 1 })
  })

  it("counts the local profiles a replace would delete", () => {
    // Replace used to drop every local profile the bundle didn't carry without
    // the dialog saying how many.
    const mine: Profile[] = [...local, { id: "c", name: "Mine only", createdAt: 4, plan: base }]
    expect(diffProfiles(mine, incoming).dropped).toBe(1)
    expect(diffProfiles(local, incoming).dropped).toBe(0)
  })

  it("merges by id, keeping local order and appending the new ones", () => {
    expect(mergeProfiles(local, incoming, "merge").map((p) => p.name)).toEqual(["Updated", "New"])
  })

  it("replaces and skips wholesale", () => {
    expect(mergeProfiles(local, incoming, "replace")).toEqual(incoming)
    expect(mergeProfiles(local, incoming, "skip")).toEqual(local)
  })
})

describe("diffFiles", () => {
  it("classifies new, same and changed files", () => {
    const incoming = {
      claudeSettings: '{"model":"opus"}',
      codexConfig: 'model = "gpt-5"\n',
      opencodeConfig: '{"model":"a"}',
    }
    const local = {
      codexConfig: 'model = "gpt-5"\n',
      opencodeConfig: '{"model":"b","extra":1}',
    }
    const out = diffFiles(incoming, local)
    expect(out.find((d) => d.key === "claudeSettings")!.status).toBe("new")
    expect(out.find((d) => d.key === "codexConfig")!.status).toBe("same")
    const oc = out.find((d) => d.key === "opencodeConfig")!
    expect(oc.status).toBe("differs")
    expect(oc.changedKeys.sort()).toEqual(["extra", "model"])
  })

  it("flags a local file it cannot parse, since its secrets can't be preserved", () => {
    const out = diffFiles({ claudeSettings: "{}" }, { claudeSettings: "{ broken" })
    expect(out[0]).toMatchObject({ status: "differs", localUnreadable: true })
  })
})

describe("diffSettings", () => {
  const local = {
    autoCheckUpdates: true,
    ghMirrorPrefix: null,
    monthlySubscriptionUsd: 20,
  } as unknown as AppSettings

  it("lists only the keys that genuinely change", () => {
    const out = diffSettings(local, { autoCheckUpdates: true, ghMirrorPrefix: "https://m/" })
    expect(out).toEqual([{ key: "ghMirrorPrefix", from: null, to: "https://m/" }])
  })
})

describe("settings secrets", () => {
  const local = {
    proxy: {
      mode: "manual",
      targets: ["npm"],
      httpUrl: "http://p:1",
      password: "local-pw",
      clientKeyPassphrase: "local-pass",
    },
  } as unknown as AppSettings

  it("puts back the proxy credentials a redacted bundle blanked", () => {
    const incoming = { proxy: { mode: "manual", targets: ["npm"], httpUrl: "http://q:2" } }
    const out = keepLocalSettingsSecrets(incoming as Partial<AppSettings>, local)
    expect(out.proxy).toMatchObject({
      httpUrl: "http://q:2",
      password: "local-pw",
      clientKeyPassphrase: "local-pass",
    })
  })

  it("keeps a credential the bundle really carried", () => {
    const incoming = { proxy: { mode: "manual", targets: ["npm"], password: "theirs" } }
    const out = keepLocalSettingsSecrets(incoming as Partial<AppSettings>, local)
    expect(out.proxy?.password).toBe("theirs")
  })

  it("leaves a bundle without a proxy alone", () => {
    const incoming = { ghMirrorPrefix: "https://m/" }
    expect(keepLocalSettingsSecrets(incoming, local)).toBe(incoming)
  })

  it("masks proxy credentials in the review line", () => {
    const line = describeSettingsChange({ key: "proxy", from: local.proxy, to: null })
    expect(line).not.toContain("local-pw")
    expect(line).not.toContain("local-pass")
    expect(line).toContain("proxy: ")
    expect(describeSettingsChange({ key: "ghMirrorPrefix", from: null, to: "https://m/" })).toBe(
      'ghMirrorPrefix: null → "https://m/"'
    )
  })
})
