jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))

import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { useAppStore } from "@/store/app-store"
import { OnboardingDialog } from "./onboarding-dialog"

beforeEach(() => {
  useAppStore.setState({ dryRun: false })
})

function renderDialog(overrides: Partial<React.ComponentProps<typeof OnboardingDialog>> = {}) {
  const onInstall = jest.fn()
  const onDismiss = jest.fn()
  const onTour = jest.fn()
  render(
    <I18nProvider>
      <OnboardingDialog
        open
        onInstall={onInstall}
        onDismiss={onDismiss}
        onTour={onTour}
        {...overrides}
      />
    </I18nProvider>
  )
  return { onInstall, onDismiss, onTour }
}

it("greets a newcomer with the plain-language rundown and preset choices", () => {
  renderDialog()
  expect(screen.getByRole("heading", { name: en.welcome.title })).toBeInTheDocument()
  expect(screen.getByText(en.welcome.whatClis)).toBeInTheDocument()
  expect(screen.getByText(en.welcome.whatCcswitch)).toBeInTheDocument()
  // One radio per preset bundle (minimal / recommended / everything).
  expect(screen.getAllByRole("radio")).toHaveLength(3)
})

it("defaults to the Recommended bundle", () => {
  renderDialog()
  // PRESETS order is minimal, recommended, everything — recommended is index 1.
  expect(screen.getAllByRole("radio")[1]).toBeChecked()
})

it("installs the default (recommended) bundle on click", async () => {
  const { onInstall } = renderDialog()
  await userEvent.click(screen.getByRole("button", { name: en.welcome.install }))
  expect(onInstall).toHaveBeenCalledWith("recommended")
})

it("installs the bundle the user picks", async () => {
  const { onInstall } = renderDialog()
  await userEvent.click(screen.getAllByRole("radio")[2]) // "everything"
  await userEvent.click(screen.getByRole("button", { name: en.welcome.install }))
  expect(onInstall).toHaveBeenCalledWith("everything")
})

it("dismisses via Maybe later", async () => {
  const { onDismiss } = renderDialog()
  await userEvent.click(screen.getByRole("button", { name: en.welcome.later }))
  expect(onDismiss).toHaveBeenCalled()
})

it("starts the guided tour from the wizard", async () => {
  const { onTour } = renderDialog()
  await userEvent.click(screen.getByRole("button", { name: `${en.tour.start} →` }))
  expect(onTour).toHaveBeenCalled()
})

it("dismisses when the dialog is closed with Escape", async () => {
  const { onDismiss } = renderDialog()
  await userEvent.keyboard("{Escape}")
  expect(onDismiss).toHaveBeenCalled()
})

it("turning on preview relabels Install and flips the shared dry-run flag", async () => {
  renderDialog()
  await userEvent.click(screen.getByRole("switch"))
  expect(useAppStore.getState().dryRun).toBe(true)
  expect(screen.getByRole("button", { name: en.welcome.installPreview })).toBeInTheDocument()
})

it("renders nothing when closed", () => {
  renderDialog({ open: false })
  expect(screen.queryByText(en.welcome.title)).not.toBeInTheDocument()
})

// Guard against a stray second dialog implementation leaking the title twice.
it("shows a single dialog", () => {
  renderDialog()
  const dialog = screen.getByRole("dialog")
  expect(within(dialog).getByRole("heading", { name: en.welcome.title })).toBeInTheDocument()
})
