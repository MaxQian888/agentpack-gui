jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() },
}))
jest.mock("@/lib/tauri/commands", () => ({
  readTextFile: jest.fn(async () => ""),
  writeTextFile: jest.fn(async () => undefined),
}))

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"
import { I18nProvider } from "@/lib/i18n/provider"
import { readTextFile, writeTextFile } from "@/lib/tauri/commands"
import { CcConnectConfigEditor } from "./ccconnect-config"
import { en } from "@/lib/i18n/en"

const PATH = "/h/.cc-connect/config.toml"

beforeEach(() => jest.clearAllMocks())

function renderEditor(exists: boolean, onSaved = jest.fn()) {
  render(
    <I18nProvider>
      <CcConnectConfigEditor path={PATH} exists={exists} onSaved={onSaved} />
    </I18nProvider>
  )
  return onSaved
}

async function openDialog(exists: boolean, onSaved = jest.fn()) {
  renderEditor(exists, onSaved)
  await userEvent.click(
    screen.getByRole("button", {
      name: exists ? en.ccconnect.configEdit : en.ccconnect.configCreate,
    })
  )
  return onSaved
}

it("offers Create wording and seeds the default template when no config exists", async () => {
  await openDialog(false)
  expect(readTextFile).not.toHaveBeenCalled()
  const toml = await screen.findByRole("tab", { name: en.ccconnect.tabToml })
  await userEvent.click(toml)
  const area = screen.getByRole("textbox", { name: en.ccconnect.tabToml })
  expect((area as HTMLTextAreaElement).value).toContain("[management]")
})

it("loads the existing config and saves a form edit back through TOML", async () => {
  ;(readTextFile as jest.Mock).mockResolvedValue("[management]\nport = 9820\n")
  const onSaved = await openDialog(true)
  // form tab is default for parseable config; edit the web port
  const port = await screen.findAllByLabelText(en.ccconnect.fields.port)
  await userEvent.clear(port[0])
  await userEvent.type(port[0], "9999")
  await userEvent.click(screen.getByRole("button", { name: en.ccconnect.save }))
  await waitFor(() =>
    expect(writeTextFile).toHaveBeenCalledWith(PATH, expect.stringContaining("port = 9999"))
  )
  expect(toast.success).toHaveBeenCalledWith(en.ccconnect.saved)
  expect(onSaved).toHaveBeenCalled()
})

it("toggles a boolean switch and edits a text field, then saves both", async () => {
  ;(readTextFile as jest.Mock).mockResolvedValue("[management]\nport = 9820\n")
  await openDialog(true)
  await userEvent.click(await screen.findByLabelText(en.ccconnect.fields.quiet))
  await userEvent.type(screen.getByLabelText(en.ccconnect.fields.dataDir), "/tmp/cc")
  await userEvent.click(screen.getByRole("button", { name: en.ccconnect.save }))
  await waitFor(() => expect(writeTextFile).toHaveBeenCalled())
  const written = (writeTextFile as jest.Mock).mock.calls.at(-1)![1] as string
  expect(written).toContain("quiet = true")
  expect(written).toContain("/tmp/cc")
})

it("changes a select field and saves the chosen value", async () => {
  ;(readTextFile as jest.Mock).mockResolvedValue("[management]\nport = 9820\n")
  await openDialog(true)
  await userEvent.click(await screen.findByLabelText(en.ccconnect.fields.logLevel))
  await userEvent.click(await screen.findByRole("option", { name: "debug" }))
  await userEvent.click(screen.getByRole("button", { name: en.ccconnect.save }))
  await waitFor(() =>
    expect(writeTextFile).toHaveBeenCalledWith(PATH, expect.stringContaining('level = "debug"'))
  )
})

it("closes the editor with a toast when the config can't be read", async () => {
  ;(readTextFile as jest.Mock).mockRejectedValue("io")
  renderEditor(true)
  await userEvent.click(screen.getByRole("button", { name: en.ccconnect.configEdit }))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en.ccconnect.loadFailed))
})

it("edits CORS origins as a comma-separated list and writes them as an array", async () => {
  ;(readTextFile as jest.Mock).mockResolvedValue('[management]\nenabled = true\ntoken = "x"\n')
  await openDialog(true)
  // Management and bridge both carry cors_origins under the same label, so the
  // section-namespaced id is what tells them apart.
  await screen.findAllByLabelText(en.ccconnect.fields.corsOrigins)
  const cors = document.getElementById("ccconf-management-corsOrigins")!
  // Set the whole value in one event: this controlled field re-serializes the
  // entire TOML doc on every keystroke, so per-character typing re-rendered the
  // form 28× and tipped the test past 5 s under coverage. We only assert the
  // final written array, so one change event is both faster and stable.
  fireEvent.change(cors, { target: { value: "http://a.test, http://b.test" } })
  await userEvent.click(screen.getByRole("button", { name: en.ccconnect.save }))
  await waitFor(() => expect(writeTextFile).toHaveBeenCalled())
  const written = (writeTextFile as jest.Mock).mock.calls.at(-1)![1] as string
  expect(written).toContain("cors_origins")
  expect(written).toContain("http://a.test")
  expect(written).toContain("http://b.test")
})

it("refuses to save invalid TOML", async () => {
  ;(readTextFile as jest.Mock).mockResolvedValue("[management]\nport = 9820\n")
  await openDialog(true)
  await userEvent.click(await screen.findByRole("tab", { name: en.ccconnect.tabToml }))
  const area = screen.getByRole("textbox", { name: en.ccconnect.tabToml })
  await userEvent.clear(area)
  await userEvent.type(area, "x = [[")
  await userEvent.click(screen.getByRole("button", { name: en.ccconnect.save }))
  expect(toast.error).toHaveBeenCalledWith(en.ccconnect.invalidToml)
  expect(writeTextFile).not.toHaveBeenCalled()
})

it("falls back to the TOML tab with a hint when the config doesn't parse", async () => {
  ;(readTextFile as jest.Mock).mockResolvedValue("broken = [")
  await openDialog(true)
  const area = await screen.findByRole("textbox", { name: en.ccconnect.tabToml })
  expect(area).toHaveValue("broken = [")
  await userEvent.click(screen.getByRole("tab", { name: en.ccconnect.tabForm }))
  expect(await screen.findByText(en.ccconnect.formUnavailable)).toBeInTheDocument()
})

it("surfaces a write failure as a toast and keeps the dialog open", async () => {
  ;(readTextFile as jest.Mock).mockResolvedValue("[management]\nport = 9820\n")
  ;(writeTextFile as jest.Mock).mockRejectedValue("io")
  await openDialog(true)
  await screen.findByRole("tab", { name: en.ccconnect.tabForm })
  await userEvent.click(screen.getByRole("button", { name: en.ccconnect.save }))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en.ccconnect.saveFailed))
  expect(screen.getByRole("dialog")).toBeInTheDocument()
})
