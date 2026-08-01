import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { useAppStore } from "@/store/app-store"
import { ChangeTray } from "./change-tray"

beforeEach(() => useAppStore.getState().resetPlan())

function renderTray() {
  const onReview = jest.fn()
  render(
    <I18nProvider>
      <ChangeTray onReview={onReview} />
    </I18nProvider>
  )
  return { onReview }
}

it("renders nothing at all when nothing is selected", () => {
  renderTray()
  // A permanently docked bar reading "0 selected" is furniture, and furniture
  // stops being read.
  expect(screen.queryByRole("region", { name: en.tray.label })).not.toBeInTheDocument()
})

it("counts the selection", () => {
  useAppStore.getState().applyPreset("minimal")
  const expected =
    useAppStore.getState().plan.clis.length +
    useAppStore.getState().plan.skills.length +
    useAppStore.getState().plan.mcps.length
  renderTray()
  expect(screen.getByText(en.tray.count(expected))).toBeInTheDocument()
})

it("leads to review, never straight to disk", async () => {
  useAppStore.getState().applyPreset("minimal")
  const { onReview } = renderTray()
  // The only forward action is Review — there is deliberately no Apply here.
  expect(screen.queryByRole("button", { name: en.review.apply })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: en.tray.review }))
  expect(onReview).toHaveBeenCalled()
})

it("clearing drops the selection but keeps the machine's own setup", async () => {
  useAppStore.getState().applyPreset("minimal")
  useAppStore.getState().setMcpKey("context7", "sk-local")
  useAppStore.getState().setNetwork({ npmRegistry: "https://mirror.example/" })
  renderTray()
  await userEvent.click(screen.getByRole("button", { name: en.tray.clear }))
  const plan = useAppStore.getState().plan
  expect(plan.clis).toEqual([])
  expect(plan.skills).toEqual([])
  // The proxy, mirror and API keys are the user's environment, not this batch's
  // selection — wiping them with the ticks would silently drop the mirror from
  // the very run that needed it.
  expect(plan.mcpKeys.context7).toBe("sk-local")
  expect(plan.network.npmRegistry).toBe("https://mirror.example/")
})

it("counts a network-only plan, which has no ticks at all", () => {
  useAppStore.getState().setNetwork({ npmRegistry: "https://mirror.example/" })
  renderTray()
  expect(screen.getByText(en.tray.count(1))).toBeInTheDocument()
})
