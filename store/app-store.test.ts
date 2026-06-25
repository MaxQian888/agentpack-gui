import { useAppStore } from "./app-store"

beforeEach(() => {
  useAppStore.setState({ osOverride: null, paths: null })
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
