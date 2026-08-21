import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { useAppStore } from "@/store/app-store"
import { PresetsSection } from "./presets"

beforeEach(() => useAppStore.getState().resetPlan())

function renderSection(props: React.ComponentProps<typeof PresetsSection> = {}) {
  render(
    <I18nProvider>
      <PresetsSection {...props} />
    </I18nProvider>
  )
}

const chip = (name: string) => screen.getByRole("button", { name, pressed: undefined })

/** Step 02 starts folded — the checklists only exist once it's opened. */
const openTuning = () =>
  userEvent.click(screen.getByRole("button", { name: en.presetsScreen.tuneShow }))

describe("presets", () => {
  it("clicking Recommended fills the plan", async () => {
    renderSection()
    await userEvent.click(await screen.findByRole("button", { name: "Recommended" }))
    expect(useAppStore.getState().plan.clis).toContain("cc-switch")
  })

  it("states what each preset installs before it is picked", () => {
    renderSection()
    // 3 CLIs, no skills, 5 MCP servers — read off the row, not discovered by
    // clicking it and counting the ticks that appear.
    expect(screen.getByText(en.presetsScreen.presetCounts(3, 0, 5))).toBeInTheDocument()
    expect(screen.getByText(en.presetsScreen.presetCountsCustom)).toBeInTheDocument()
  })

  it("Custom clears the selection and opens the checklists it needs", async () => {
    // "Choose everything manually" with nothing on screen to choose from is a
    // dead end, so Custom unfolds step 02 on the way.
    useAppStore.getState().applyPreset("recommended")
    renderSection()
    await userEvent.click(chip(en.installDialog.custom))
    expect(useAppStore.getState().plan.clis).toEqual([])
    expect(screen.getByRole("tab", { name: en.installDialog.clis })).toBeInTheDocument()
  })

  it("marks the preset the plan already matches, even when chosen elsewhere", async () => {
    useAppStore.getState().applyPreset("minimal")
    renderSection()
    expect(await screen.findByRole("button", { name: "Minimal" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    // Editing the selection by hand drops it back to Custom.
    await openTuning()
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
  it("organizes the guided steps and the selection summary as one workbench", () => {
    useAppStore.getState().applyPreset("minimal")
    renderSection()

    expect(screen.getByRole("region", { name: en.presetsScreen.catalogPanel })).toBeInTheDocument()
    expect(
      screen.getByRole("complementary", { name: en.presetsScreen.actionsLabel })
    ).toBeInTheDocument()
    // Read top to bottom: one decision, one optional detour, one destination.
    for (const heading of [
      en.presetsScreen.stepPick,
      en.presetsScreen.stepTune,
      en.presetsScreen.stepReview,
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument()
    }
  })

  it("keeps the sixteen-CLI checklist folded until it is asked for", async () => {
    renderSection()
    expect(screen.queryByRole("tab", { name: en.installDialog.clis })).not.toBeInTheDocument()
    await openTuning()
    expect(screen.getByRole("tab", { name: en.installDialog.clis })).toBeInTheDocument()
  })

  it("ticking a skill targets the agents the plan installs", async () => {
    useAppStore.getState().applyPreset("minimal")
    useAppStore.getState().setSkill("rust", [])
    renderSection()
    await openTuning()
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
})

describe("step 03", () => {
  it("offers the way onward only once there is something to review", async () => {
    const onReview = jest.fn()
    renderSection({ onReview })
    expect(screen.getByText(en.presetsScreen.emptyHint)).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Recommended" }))
    await userEvent.click(screen.getByRole("button", { name: en.presetsScreen.reviewAction(8) }))
    expect(onReview).toHaveBeenCalled()
  })

  it("starts nothing — the review panel is still the only way to disk", () => {
    renderSection({ onReview: jest.fn() })
    expect(screen.queryByRole("button", { name: en.installDialog.install })).not.toBeInTheDocument()
    expect(screen.queryByRole("switch")).not.toBeInTheDocument()
  })
})
