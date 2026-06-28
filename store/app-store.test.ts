import { useAppStore } from "./app-store"

beforeEach(() => {
  useAppStore.setState({ osOverride: null, paths: null, profiles: [], currentProfileId: null })
  useAppStore.getState().resetPlan()
})

it("setMcp adds then clears by empty targets", () => {
  useAppStore.getState().setMcp("context7", ["claude"])
  expect(useAppStore.getState().plan.mcps).toHaveLength(1)
  useAppStore.getState().setMcp("context7", [])
  expect(useAppStore.getState().plan.mcps).toHaveLength(0)
})

it("toggleCli adds and removes", () => {
  useAppStore.getState().toggleCli("codex")
  expect(useAppStore.getState().plan.clis).toContain("codex")
  useAppStore.getState().toggleCli("codex")
  expect(useAppStore.getState().plan.clis).not.toContain("codex")
})

it("applyPreset recommended fills clis", () => {
  useAppStore.getState().applyPreset("recommended")
  expect(useAppStore.getState().plan.clis).toContain("cc-switch")
})

it("osOverride changes effectiveOS + plan.os", () => {
  useAppStore.getState().setOsOverride("win")
  expect(useAppStore.getState().effectiveOS()).toBe("win")
  expect(useAppStore.getState().plan.os).toBe("win")
})

it("saveCurrentAsProfile snapshots the plan and marks it current", () => {
  useAppStore.getState().toggleCli("codex")
  const p = useAppStore.getState().saveCurrentAsProfile("Work")
  expect(p.name).toBe("Work")
  expect(p.plan.clis).toContain("codex")
  expect(useAppStore.getState().profiles).toHaveLength(1)
  expect(useAppStore.getState().currentProfileId).toBe(p.id)
})

it("applyProfile restores the saved plan; unknown id is a no-op", () => {
  useAppStore.getState().toggleCli("codex")
  const p = useAppStore.getState().saveCurrentAsProfile("Work")
  useAppStore.getState().resetPlan()
  expect(useAppStore.getState().plan.clis).not.toContain("codex")
  useAppStore.getState().applyProfile(p.id)
  expect(useAppStore.getState().plan.clis).toContain("codex")
  useAppStore.getState().applyProfile("missing")
  expect(useAppStore.getState().currentProfileId).toBe(p.id)
})

it("rename + delete mutate the profile list and clear current on delete", () => {
  const p = useAppStore.getState().saveCurrentAsProfile("Old")
  useAppStore.getState().renameProfile(p.id, "New")
  expect(useAppStore.getState().profiles[0].name).toBe("New")
  useAppStore.getState().deleteProfile(p.id)
  expect(useAppStore.getState().profiles).toHaveLength(0)
  expect(useAppStore.getState().currentProfileId).toBeNull()
})

it("setProfiles replaces the list", () => {
  useAppStore
    .getState()
    .setProfiles([{ id: "x", name: "X", createdAt: 0, plan: useAppStore.getState().plan }])
  expect(useAppStore.getState().profiles.map((p) => p.id)).toEqual(["x"])
})
