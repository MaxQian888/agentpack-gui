import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { useAppStore } from "@/store/app-store"
import { PresetsSection } from "./presets"

beforeEach(() => useAppStore.getState().resetPlan())

function renderSection() {
  render(
    <I18nProvider>
      <PresetsSection />
    </I18nProvider>
  )
}

const chip = (name: string) => screen.getByRole("button", { name, pressed: undefined })

describe("bundles", () => {
  it("clicking Recommended fills the plan", async () => {
    renderSection()
    await userEvent.click(await screen.findByText("Recommended"))
    expect(useAppStore.getState().plan.clis).toContain("cc-switch")
  })

  it("Custom clears the selection and leaves the checklists in place", async () => {
    // There is no dialog to open any more — the checklists this used to launch
    // are on the same page, so "Custom" is just "start from nothing".
    useAppStore.getState().applyPreset("recommended")
    renderSection()
    await userEvent.click(await screen.findByText(en.installDialog.custom))
    expect(useAppStore.getState().plan.clis).toEqual([])
    expect(screen.getByRole("tab", { name: en.installDialog.clis })).toBeInTheDocument()
  })

  it("marks the bundle the plan already matches, even when chosen elsewhere", async () => {
    useAppStore.getState().applyPreset("minimal")
    renderSection()
    expect(await screen.findByRole("button", { name: "Minimal" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    // Editing the selection by hand drops it back to Custom.
    await userEvent.click(screen.getByRole("tab", { name: en.installDialog.clis }))
    await userEvent.click(screen.getByLabelText(en.catalog.cli["codex"].title))
    expect(chip(en.installDialog.custom)).toHaveAttribute("aria-pressed", "true")
  })

  it("marks nothing at all when the plan is empty", () => {
    renderSection()
    for (const el of screen.getAllByRole("button")) {
      expect(el).not.toHaveAttribute("aria-pressed", "true")
    }
  })
})

describe("checklists", () => {
  it("organizes bundle status, checklists, and the selection summary as one workbench", () => {
    useAppStore.getState().applyPreset("minimal")
    renderSection()

    expect(screen.getByRole("region", { name: en.presetsScreen.summaryLabel })).toBeInTheDocument()
    expect(screen.getByRole("region", { name: en.presetsScreen.catalogPanel })).toBeInTheDocument()
    expect(
      screen.getByRole("complementary", { name: en.presetsScreen.actionsLabel })
    ).toBeInTheDocument()
  })

  it("ticking a skill targets the agents the plan installs", async () => {
    useAppStore.getState().applyPreset("minimal")
    useAppStore.getState().setSkill("rust", [])
    renderSection()
    await userEvent.click(screen.getByRole("tab", { name: en.installDialog.skills }))
    await userEvent.click(screen.getByLabelText(en.catalog.skills["rust"].title))
    const picked = useAppStore.getState().plan.skills.find((s) => s.id === "rust")
    expect(picked?.targets.length).toBeGreaterThan(0)
  })

  it("summarises the selection rather than making the user re-read the ticks", async () => {
    useAppStore.getState().applyPreset("minimal")
    renderSection()
    const summary = screen.getByRole("region", { name: en.installDialog.summary })
    for (const id of useAppStore.getState().plan.clis) {
      expect(summary).toHaveTextContent(en.catalog.cli[id].title)
    }
  })

  it("says so plainly when nothing is selected", () => {
    renderSection()
    expect(screen.getByRole("region", { name: en.installDialog.summary })).toHaveTextContent(
      en.installDialog.summaryEmpty
    )
  })

  it("starts nothing — the tray and the review panel are the only way to disk", () => {
    renderSection()
    expect(screen.queryByRole("button", { name: en.installDialog.install })).not.toBeInTheDocument()
    expect(screen.queryByRole("switch")).not.toBeInTheDocument()
  })
})
