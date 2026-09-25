import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { useAppStore } from "@/store/app-store"
import { ChangeTray } from "./change-tray"

beforeEach(() => {
  useAppStore.setState({ appliedNpmRegistry: undefined })
  useAppStore.getState().setSettings({ proxy: null })
  useAppStore.getState().clearSelection()
})

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
  // A mirror an earlier run already wrote is the machine's setup, not a pick.
  useAppStore.getState().setNetwork({ npmRegistry: "https://mirror.example/" })
  useAppStore.getState().markNetworkApplied(useAppStore.getState().plan.network)
  renderTray()
  await userEvent.click(screen.getByRole("button", { name: en.tray.clear }))
  const plan = useAppStore.getState().plan
  expect(plan.clis).toEqual([])
  expect(plan.skills).toEqual([])
  // The applied mirror and the API keys are the user's environment — wiping them
  // with the ticks would silently drop the mirror from the very run that needed
  // it.
  expect(plan.mcpKeys.context7).toBe("sk-local")
  expect(plan.network.npmRegistry).toBe("https://mirror.example/")
  expect(screen.queryByRole("region", { name: en.tray.label })).not.toBeInTheDocument()
})

it("clearing also drops a network change that was never applied", async () => {
  // Kept, this was the tray that couldn't be cleared: "1 selected", Clear, still
  // "1 selected".
  useAppStore.getState().setNetwork({ npmRegistry: "https://mirror.example/" })
  renderTray()
  expect(screen.getByText(en.tray.count(1))).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: en.tray.clear }))
  expect(useAppStore.getState().plan.network.npmRegistry).toBeUndefined()
  expect(screen.queryByRole("region", { name: en.tray.label })).not.toBeInTheDocument()
})

it("turns into the way back to a running run, rather than a review it can't start", async () => {
  useAppStore.getState().applyPreset("minimal")
  const onReview = jest.fn()
  const onShowRun = jest.fn()
  render(
    <I18nProvider>
      <ChangeTray onReview={onReview} running onShowRun={onShowRun} />
    </I18nProvider>
  )
  await userEvent.click(screen.getByRole("button", { name: en.shell.showRun }))
  expect(onShowRun).toHaveBeenCalled()
  expect(onReview).not.toHaveBeenCalled()
})

it("says it is preparing, and can't be pressed twice, while the review is built", () => {
  useAppStore.getState().applyPreset("minimal")
  render(
    <I18nProvider>
      <ChangeTray onReview={jest.fn()} preparing />
    </I18nProvider>
  )
  expect(screen.getByRole("button", { name: en.shell.preparing })).toBeDisabled()
})

it("does not count a proxy that is already applied", () => {
  // Startup restores the applied proxy into the plan; it must not reopen the
  // tray on every launch.
  const proxy = {
    mode: "manual" as const,
    httpUrl: "http://127.0.0.1:7890",
    targets: ["npm" as const],
  }
  useAppStore.getState().setSettings({ proxy })
  useAppStore.getState().setProxy(proxy)
  renderTray()
  expect(screen.queryByRole("region", { name: en.tray.label })).not.toBeInTheDocument()
  // A different proxy is a change, and counts.
  act(() => useAppStore.getState().setProxy({ httpUrl: "http://127.0.0.1:8080" }))
  expect(screen.getByText(en.tray.count(1))).toBeInTheDocument()
})
