jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() },
}))
jest.mock("@/lib/tauri/commands", () => ({
  readTextFile: jest.fn(async () => ""),
  writeTextFile: jest.fn(async () => undefined),
  pathExists: jest.fn(async () => false),
}))

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"
import { CONFIG_FILES } from "@/lib/agentpack/config-editor/files"
import { BACKUP_SUFFIX } from "@/lib/agentpack/plan"
import { en } from "@/lib/i18n/en"
import { I18nProvider } from "@/lib/i18n/provider"
import { pathExists, readTextFile, writeTextFile } from "@/lib/tauri/commands"
import { ConfigFileEditor } from "./config-file-editor"

const t = en.configFiles
const claudeSettings = CONFIG_FILES.find((f) => f.id === "claudeSettings")!
const codexConfig = CONFIG_FILES.find((f) => f.id === "codexConfig")!
const claudeConfig = CONFIG_FILES.find((f) => f.id === "claudeConfig")!

const SETTINGS_PATH = "/h/.claude/settings.json"

beforeEach(() => {
  jest.clearAllMocks()
  ;(pathExists as jest.Mock).mockResolvedValue(false)
})

async function openEditor(
  def = claudeSettings,
  { exists = true, path = SETTINGS_PATH, onSaved = jest.fn(), onOpenMcp = jest.fn() } = {}
) {
  render(
    <I18nProvider>
      <ConfigFileEditor
        def={def}
        path={path}
        exists={exists}
        onSaved={onSaved}
        onOpenMcp={onOpenMcp}
      />
    </I18nProvider>
  )
  await userEvent.click(screen.getByRole("button", { name: exists ? t.edit : t.create }))
  return { onSaved, onOpenMcp }
}

/** Switch to the Text tab and return its textarea. */
async function rawArea() {
  await userEvent.click(await screen.findByRole("tab", { name: t.tabRaw }))
  return screen.getByRole("textbox", { name: t.tabRaw }) as HTMLTextAreaElement
}

it("offers Create wording and seeds an empty JSON doc when the file is missing", async () => {
  await openEditor(claudeSettings, { exists: false })
  expect(readTextFile).not.toHaveBeenCalled()
  expect((await rawArea()).value).toBe("{}\n")
})

it("keeps unknown top-level keys when a form edit rewrites the file", async () => {
  ;(readTextFile as jest.Mock).mockResolvedValue('{"vendorOnly": {"deep": 1}}')
  await openEditor()
  await userEvent.type(await screen.findByLabelText(t.fields.claudeModel), "opus")
  await userEvent.click(screen.getByRole("button", { name: t.save }))
  await waitFor(() => expect(writeTextFile).toHaveBeenCalledWith(SETTINGS_PATH, expect.any(String)))
  const written = (writeTextFile as jest.Mock).mock.calls.at(-1)![1] as string
  expect(JSON.parse(written)).toEqual({ vendorOnly: { deep: 1 }, model: "opus" })
})

it("backs the original up before the first write", async () => {
  ;(readTextFile as jest.Mock).mockResolvedValue('{"model": "sonnet"}')
  await openEditor()
  await userEvent.type(await screen.findByLabelText(t.fields.claudeApiKeyHelper), "x")
  await userEvent.click(screen.getByRole("button", { name: t.save }))
  await waitFor(() => expect(writeTextFile).toHaveBeenCalledTimes(2))
  const [backupCall, mainCall] = (writeTextFile as jest.Mock).mock.calls
  expect(backupCall).toEqual([`${SETTINGS_PATH}${BACKUP_SUFFIX}`, '{"model": "sonnet"}'])
  expect(mainCall[0]).toBe(SETTINGS_PATH)
})

it("does not rewrite an existing backup", async () => {
  ;(readTextFile as jest.Mock).mockResolvedValue('{"model": "sonnet"}')
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  await openEditor()
  await userEvent.type(await screen.findByLabelText(t.fields.claudeApiKeyHelper), "x")
  await userEvent.click(screen.getByRole("button", { name: t.save }))
  await waitFor(() => expect(writeTextFile).toHaveBeenCalledTimes(1))
  expect((writeTextFile as jest.Mock).mock.calls[0][0]).toBe(SETTINGS_PATH)
})

it("refuses to save invalid text and says which syntax it wanted", async () => {
  ;(readTextFile as jest.Mock).mockResolvedValue('{"model": "sonnet"}')
  await openEditor()
  const area = await rawArea()
  await userEvent.clear(area)
  // `{` starts a userEvent key descriptor, so it has to be doubled.
  await userEvent.type(area, "{{not json")
  await userEvent.click(screen.getByRole("button", { name: t.save }))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t.invalidJson))
  expect(writeTextFile).not.toHaveBeenCalled()
})

it("falls back to the raw tab when the file on disk does not parse", async () => {
  ;(readTextFile as jest.Mock).mockResolvedValue("{ broken")
  await openEditor()
  await userEvent.click(await screen.findByRole("tab", { name: t.tabForm }))
  expect(screen.getByText(t.formUnavailable)).toBeInTheDocument()
  expect((await rawArea()).value).toBe("{ broken")
})

it("blocks a save when the file changed on disk, and overwrites only on demand", async () => {
  ;(readTextFile as jest.Mock).mockResolvedValue('{"model": "sonnet"}')
  await openEditor()
  await userEvent.type(await screen.findByLabelText(t.fields.claudeModel), "!")
  // Someone else wrote the file while the dialog was open.
  ;(readTextFile as jest.Mock).mockResolvedValue('{"model": "elsewhere"}')
  await userEvent.click(screen.getByRole("button", { name: t.save }))
  expect(await screen.findByText(t.conflictTitle)).toBeInTheDocument()
  expect(writeTextFile).not.toHaveBeenCalled()

  await userEvent.click(screen.getByRole("button", { name: t.conflictOverwrite }))
  await waitFor(() => expect(writeTextFile).toHaveBeenCalled())
  // The backup captures what was actually on disk, not the stale baseline.
  expect((writeTextFile as jest.Mock).mock.calls[0]).toEqual([
    `${SETTINGS_PATH}${BACKUP_SUFFIX}`,
    '{"model": "elsewhere"}',
  ])
})

it("guards a dirty close behind a discard confirmation", async () => {
  ;(readTextFile as jest.Mock).mockResolvedValue('{"model": "sonnet"}')
  await openEditor()
  await userEvent.type(await screen.findByLabelText(t.fields.claudeModel), "!")
  await userEvent.click(screen.getByRole("button", { name: t.cancel }))
  expect(await screen.findByText(t.discardTitle)).toBeInTheDocument()

  await userEvent.click(screen.getByRole("button", { name: t.discardCancel }))
  expect(screen.getByRole("button", { name: t.save })).toBeInTheDocument()

  await userEvent.click(screen.getByRole("button", { name: t.cancel }))
  await userEvent.click(await screen.findByRole("button", { name: t.discardConfirm }))
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: t.save })).not.toBeInTheDocument()
  )
  expect(writeTextFile).not.toHaveBeenCalled()
})

it("never rewrites an untouched file — Save stays disabled until something changes", async () => {
  ;(readTextFile as jest.Mock).mockResolvedValue('{"model": "sonnet"}')
  await openEditor()
  expect(await screen.findByRole("button", { name: t.save })).toBeDisabled()
  await userEvent.type(screen.getByLabelText(t.fields.claudeModel), "!")
  expect(screen.getByRole("button", { name: t.save })).toBeEnabled()
  // Reset drops the edit and disables Save again.
  await userEvent.click(screen.getByRole("button", { name: t.reset }))
  await waitFor(() => expect(screen.getByRole("button", { name: t.save })).toBeDisabled())
})

it("writes and clears an env map through the string-map rows", async () => {
  ;(readTextFile as jest.Mock).mockResolvedValue("{}")
  await openEditor()
  await userEvent.click(await screen.findByRole("button", { name: t.mapAdd }))
  await userEvent.type(screen.getByLabelText(`${t.fields.claudeEnvVars} ${t.mapKey} 1`), "FOO")
  await userEvent.type(screen.getByLabelText(`${t.fields.claudeEnvVars} ${t.mapValue} 1`), "bar")
  await userEvent.click(screen.getByRole("button", { name: t.save }))
  await waitFor(() => expect(writeTextFile).toHaveBeenCalled())
  expect(JSON.parse((writeTextFile as jest.Mock).mock.calls.at(-1)![1])).toEqual({
    env: { FOO: "bar" },
  })
})

it("locks a field whose on-disk value is a shape the widget cannot express", async () => {
  // statusLine as a template string blocks the command-object fields.
  ;(readTextFile as jest.Mock).mockResolvedValue('{"statusLine": "${model}"}')
  await openEditor()
  expect(await screen.findByLabelText(t.fields.claudeStatusCommand)).toBeDisabled()
  expect(screen.getByLabelText(t.fields.claudeModel)).toBeEnabled()
})

it("keeps a select value the declared enum does not list", async () => {
  ;(readTextFile as jest.Mock).mockResolvedValue('{"theme": "dark-daltonized"}')
  await openEditor()
  expect(await screen.findByLabelText(t.fields.claudeTheme)).toHaveTextContent("dark-daltonized")
  // An unrelated edit must not drop it.
  await userEvent.type(screen.getByLabelText(t.fields.claudeModel), "opus")
  await userEvent.click(screen.getByRole("button", { name: t.save }))
  await waitFor(() => expect(writeTextFile).toHaveBeenCalled())
  expect(JSON.parse((writeTextFile as jest.Mock).mock.calls.at(-1)![1]).theme).toBe(
    "dark-daltonized"
  )
})

it("saves TOML through the codex schema", async () => {
  ;(readTextFile as jest.Mock).mockResolvedValue('model = "gpt-5"\n')
  await openEditor(codexConfig, { path: "/h/.codex/config.toml" })
  await userEvent.type(await screen.findByLabelText(t.fields.codexContextWindow), "400000")
  await userEvent.click(screen.getByRole("button", { name: t.save }))
  await waitFor(() =>
    expect(writeTextFile).toHaveBeenCalledWith(
      "/h/.codex/config.toml",
      expect.stringContaining("model_context_window = 400000")
    )
  )
})

describe("~/.claude.json", () => {
  const PATH = "/h/.claude.json"

  it("warns it is volatile and offers a read-only MCP inventory instead of fields", async () => {
    ;(readTextFile as jest.Mock).mockResolvedValue(
      JSON.stringify({ mcpServers: { memory: { command: "npx", args: ["-y", "server"] } } })
    )
    const { onOpenMcp } = await openEditor(claudeConfig, { path: PATH })
    expect(await screen.findByText(t.volatileWarning)).toBeInTheDocument()
    expect(screen.getByText("memory")).toBeInTheDocument()
    expect(screen.queryByLabelText(t.fields.claudeModel)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: t.openMcp }))
    expect(onOpenMcp).toHaveBeenCalled()
  })

  it("replaces the text editor with a notice once the file is too large", async () => {
    const huge = JSON.stringify({ projects: { a: "x".repeat(200_000) } })
    ;(readTextFile as jest.Mock).mockResolvedValue(huge)
    await openEditor(claudeConfig, { path: PATH })
    await userEvent.click(await screen.findByRole("tab", { name: t.tabRaw }))
    expect(screen.queryByRole("textbox", { name: t.tabRaw })).not.toBeInTheDocument()
    expect(screen.getByText(/too large/i)).toBeInTheDocument()
  })
})
