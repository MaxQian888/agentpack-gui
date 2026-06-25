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
