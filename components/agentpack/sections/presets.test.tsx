import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { PresetsSection } from "./presets"

beforeEach(() => useAppStore.getState().resetPlan())

it("clicking Recommended fills the plan", async () => {
  render(
    <I18nProvider>
      <PresetsSection />
    </I18nProvider>
  )
  await userEvent.click(await screen.findByText("Recommended"))
  expect(useAppStore.getState().plan.clis).toContain("cc-switch")
})

it("Custom resets the plan", async () => {
  useAppStore.getState().applyPreset("recommended")
  render(
    <I18nProvider>
      <PresetsSection />
    </I18nProvider>
  )
  await userEvent.click(await screen.findByText("Custom"))
  expect(useAppStore.getState().plan.clis).toHaveLength(0)
})

it("ticks the bundle the plan already matches, even when chosen elsewhere", async () => {
  useAppStore.getState().applyPreset("minimal")
  render(
    <I18nProvider>
      <PresetsSection />
    </I18nProvider>
  )
  const card = (await screen.findByText("Minimal")).closest("[role=button]")!
  expect(card).toHaveAttribute("class", expect.stringContaining("ring-primary"))
  // Editing the selection by hand drops it back to Custom.
  useAppStore.getState().toggleCli("codex")
  const custom = (await screen.findByText("Custom")).closest("[role=button]")!
  expect(custom).toHaveAttribute("class", expect.stringContaining("ring-primary"))
})

it("Custom opens the customize dialog when a handler is provided", async () => {
  const onCustomize = jest.fn()
  render(
    <I18nProvider>
      <PresetsSection onCustomize={onCustomize} />
    </I18nProvider>
  )
  await userEvent.click(await screen.findByText("Custom"))
  expect(onCustomize).toHaveBeenCalled()
})
