import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { Header } from "./header"
import { en } from "@/lib/i18n/en"

beforeEach(() => useAppStore.setState({ dryRun: false, osOverride: null }))

function renderHeader(onRun = jest.fn()) {
  render(
    <I18nProvider>
      <Header onRun={onRun} />
    </I18nProvider>
  )
  return { onRun }
}

it("toggles dry-run via the preview switch", async () => {
  renderHeader()
  expect(useAppStore.getState().dryRun).toBe(false)
  await userEvent.click(screen.getByLabelText(en.shell.preview))
  expect(useAppStore.getState().dryRun).toBe(true)
})

it("invokes onRun when the run button is clicked", async () => {
  const { onRun } = renderHeader()
  await userEvent.click(screen.getByRole("button", { name: en.shell.run }))
  expect(onRun).toHaveBeenCalled()
})

it("toggles the theme without throwing", async () => {
  renderHeader()
  await userEvent.click(screen.getByRole("button", { name: en.shell.toggleTheme }))
  expect(screen.getByRole("button", { name: en.shell.toggleTheme })).toBeInTheDocument()
})

it("renders only the plain Run button when the quick-install handlers are absent", () => {
  renderHeader()
  expect(screen.getByRole("button", { name: en.shell.run })).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: en.shell.quickInstall })).not.toBeInTheDocument()
})

function renderMenuHeader() {
  const onRun = jest.fn()
  const onQuickInstall = jest.fn()
  const onCustomize = jest.fn()
  render(
    <I18nProvider>
      <Header onRun={onRun} onQuickInstall={onQuickInstall} onCustomize={onCustomize} />
    </I18nProvider>
  )
  return { onRun, onQuickInstall, onCustomize }
}

it("runs a preset bundle from the Run ▾ quick-install menu", async () => {
  const { onQuickInstall } = renderMenuHeader()
  await userEvent.click(screen.getByRole("button", { name: en.shell.quickInstall }))
  await userEvent.click(screen.getByRole("menuitem", { name: en.presets.everything.title }))
  expect(onQuickInstall).toHaveBeenCalledWith("everything")
})

it("opens the customize dialog from the Run ▾ menu", async () => {
  const { onCustomize } = renderMenuHeader()
  await userEvent.click(screen.getByRole("button", { name: en.shell.quickInstall }))
  await userEvent.click(screen.getByRole("menuitem", { name: en.shell.customize }))
  expect(onCustomize).toHaveBeenCalled()
})
