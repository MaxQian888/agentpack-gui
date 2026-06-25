jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/commands", () => ({
  detectCli: jest.fn(async () => ({ installed: false })),
  ccLoadProviders: jest.fn(async () => [
    { id: "1", app_type: "claude", name: "Mine", settings_config: "{}", is_current: false },
  ]),
  runCommand: jest.fn(async (_cmd: unknown, onLine: (l: string) => void) => {
    onLine("installing")
    return 0
  }),
  readTextFile: jest.fn(async () => "{}"),
  writeTextFile: jest.fn(async () => undefined),
  ccWriteProvider: jest.fn(async () => ["ok"]),
}))

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { RunnerProvider } from "../run/runner-context"
import { useAppStore } from "@/store/app-store"
import { ccWriteProvider, runCommand, writeTextFile, ccLoadProviders } from "@/lib/tauri/commands"
import { CcSwitchSection } from "./ccswitch"
import { en } from "@/lib/i18n/en"

const CC_SETTINGS = "/h/.cc-switch/settings.json"
const paths = { ccSwitchSettings: CC_SETTINGS, os: "mac" } as never

beforeEach(() => {
  useAppStore.setState({ paths, dryRun: false, panelOpen: false, osOverride: null })
})

function renderCc() {
  return render(
    <I18nProvider>
      <RunnerProvider>
        <CcSwitchSection />
      </RunnerProvider>
    </I18nProvider>
  )
}

it("lists providers from the DB", async () => {
  renderCc()
  expect(await screen.findByText("Mine")).toBeInTheDocument()
})

it("installs cc-switch via the runner when not detected", async () => {
  renderCc()
  const install = await screen.findByRole("button", { name: en.ccswitch.install })
  await userEvent.click(install)
  await waitFor(() => expect(runCommand).toHaveBeenCalled())
})

it("applies the visible-apps selection", async () => {
  renderCc()
  await userEvent.click(screen.getByRole("button", { name: en.shell.apply }))
  await waitFor(() => expect(writeTextFile).toHaveBeenCalledWith(CC_SETTINGS, expect.any(String)))
})

it("toggles a visible-app switch", async () => {
  renderCc()
  const geminiSwitch = screen.getByLabelText(en.ccswitch.appLabels.gemini)
  expect(geminiSwitch).not.toBeChecked()
  await userEvent.click(geminiSwitch)
  expect(geminiSwitch).toBeChecked()
})

it("adds a provider through the form", async () => {
  renderCc()
  await screen.findByText("Mine")
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.addProvider }))
  await userEvent.type(screen.getByLabelText(en.ccswitch.fieldName), "New Provider")
  await userEvent.click(screen.getByRole("button", { name: en.shell.save }))
  await waitFor(() =>
    expect(ccWriteProvider).toHaveBeenCalledWith(expect.objectContaining({ op: "add" }))
  )
})

it("opens the edit form for an existing provider", async () => {
  renderCc()
  await screen.findByText("Mine")
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.rowActionEdit }))
  expect(screen.getByText(en.ccswitch.formEditTitle)).toBeInTheDocument()
})

it("sets a provider as current", async () => {
  renderCc()
  await screen.findByText("Mine")
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.rowActionSetCurrent }))
  await waitFor(() =>
    expect(ccWriteProvider).toHaveBeenCalledWith(expect.objectContaining({ op: "setCurrent" }))
  )
})

it("deletes a non-current provider", async () => {
  renderCc()
  await screen.findByText("Mine")
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.rowActionDelete }))
  await waitFor(() =>
    expect(ccWriteProvider).toHaveBeenCalledWith(expect.objectContaining({ op: "delete" }))
  )
})

it("offers recommended provider presets", async () => {
  renderCc()
  const presetBtn = screen.getAllByRole("button").find((b) => b.querySelector("svg"))
  expect(presetBtn).toBeTruthy()
})

it("falls back to the no-db message when the list is empty", async () => {
  ;(ccLoadProviders as jest.Mock).mockResolvedValueOnce([])
  renderCc()
  expect(await screen.findByText(en.ccswitch.empty)).toBeInTheDocument()
})
