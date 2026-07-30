jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() },
}))
jest.mock("@/lib/tauri", () => ({ isTauri: jest.fn(() => true) }))
jest.mock("@/lib/tauri/commands", () => ({
  writeTextFile: jest.fn(async () => undefined),
  readTextFile: jest.fn(async () => ""),
  ccLoadProviders: jest.fn(async () => []),
}))
jest.mock("@/lib/tauri/dialog", () => ({ pickSavePath: jest.fn(async () => "/tmp/b.json") }))
jest.mock("@/lib/tauri/clipboard", () => ({ copyText: jest.fn(async () => true) }))

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { Provider } from "@/lib/agentpack/ccswitch/types"
import type { Plan, Paths } from "@/lib/agentpack/types"
import { en } from "@/lib/i18n/en"
import { I18nProvider } from "@/lib/i18n/provider"
import { copyText } from "@/lib/tauri/clipboard"
import { ccLoadProviders, readTextFile, writeTextFile } from "@/lib/tauri/commands"
import { pickSavePath } from "@/lib/tauri/dialog"
import { useAppStore } from "@/store/app-store"
import { ExportBundleDialog } from "./export-dialog"

const b = en.bundle

const MCP_KEY = "mcp-live-secret"
const PROVIDER_TOKEN = "provider-live-secret"
const FILE_TOKEN = "settings-live-secret"

const PLAN: Plan = {
  os: "mac",
  clis: ["claude-code"],
  skills: [],
  mcps: [{ id: "context7", targets: ["claude"] }],
  mcpKeys: { context7: MCP_KEY },
  network: {},
}

const PATHS = {
  home: "/h",
  claudeSettings: "/h/.claude/settings.json",
  claudeConfig: "/h/.claude.json",
  codexConfig: "/h/.codex/config.toml",
  opencodeConfig: "/h/.config/opencode/opencode.json",
  ccConnectConfig: "/h/.cc-connect/config.toml",
  os: "mac",
} as unknown as Paths

const PROVIDERS: Provider[] = [
  {
    id: "p1",
    app_type: "claude",
    name: "Gateway",
    settings_config: JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: PROVIDER_TOKEN } }),
    is_current: true,
  },
]

beforeEach(() => {
  jest.clearAllMocks()
  ;(pickSavePath as jest.Mock).mockResolvedValue("/tmp/b.json")
  ;(ccLoadProviders as jest.Mock).mockResolvedValue(PROVIDERS)
  ;(readTextFile as jest.Mock).mockImplementation(async (p: string) =>
    p.endsWith("settings.json") ? JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: FILE_TOKEN } }) : ""
  )
  useAppStore.setState({ plan: PLAN, paths: PATHS, profiles: [] })
})

async function openDialog() {
  render(
    <I18nProvider>
      <ExportBundleDialog />
    </I18nProvider>
  )
  await userEvent.click(screen.getByRole("button", { name: b.exportOpen }))
}

/** The JSON written to disk by the last Save. */
function written() {
  return JSON.parse((writeTextFile as jest.Mock).mock.calls.at(-1)![1] as string)
}

it("writes a bundle carrying every selected part to the chosen path", async () => {
  await openDialog()
  await userEvent.click(await screen.findByRole("button", { name: b.saveFile }))
  await waitFor(() => expect(writeTextFile).toHaveBeenCalled())
  expect((writeTextFile as jest.Mock).mock.calls.at(-1)![0]).toBe("/tmp/b.json")
  const bundle = written()
  expect(bundle.version).toBe(2)
  expect(bundle.plan.clis).toEqual(["claude-code"])
  expect(bundle.providers).toHaveLength(1)
  expect(bundle.files.claudeSettings).toBeDefined()
  expect(bundle.settings).toBeDefined()
})

it("redacts every credential by default", async () => {
  await openDialog()
  await userEvent.click(await screen.findByRole("button", { name: b.saveFile }))
  await waitFor(() => expect(writeTextFile).toHaveBeenCalled())
  const text = (writeTextFile as jest.Mock).mock.calls.at(-1)![1] as string
  for (const secret of [MCP_KEY, PROVIDER_TOKEN, FILE_TOKEN]) expect(text).not.toContain(secret)
})

it("carries credentials — and renames the file — once the switch is on", async () => {
  await openDialog()
  await userEvent.click(await screen.findByLabelText(b.includeSecrets))
  expect(screen.getByText(b.secretsWarning)).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: b.saveFile }))
  await waitFor(() => expect(writeTextFile).toHaveBeenCalled())
  const text = (writeTextFile as jest.Mock).mock.calls.at(-1)![1] as string
  for (const secret of [MCP_KEY, PROVIDER_TOKEN, FILE_TOKEN]) expect(text).toContain(secret)
  expect((pickSavePath as jest.Mock).mock.calls.at(-1)![0].defaultPath).toBe(
    "agentpack.bundle.secrets.json"
  )
})

it("omits a part that was unchecked", async () => {
  await openDialog()
  await userEvent.click(await screen.findByLabelText(b.partProviders))
  await userEvent.click(screen.getByRole("button", { name: b.saveFile }))
  await waitFor(() => expect(writeTextFile).toHaveBeenCalled())
  expect(written()).not.toHaveProperty("providers")
  expect(ccLoadProviders).not.toHaveBeenCalled()
})

it("never puts credentials on the clipboard, even with the switch on", async () => {
  await openDialog()
  await userEvent.click(await screen.findByLabelText(b.includeSecrets))
  await userEvent.click(screen.getByRole("button", { name: b.copyToClipboard }))
  await waitFor(() => expect(copyText).toHaveBeenCalled())
  const text = (copyText as jest.Mock).mock.calls.at(-1)![0] as string
  for (const secret of [MCP_KEY, PROVIDER_TOKEN, FILE_TOKEN]) expect(text).not.toContain(secret)
})

it("writes nothing when the save dialog is cancelled", async () => {
  ;(pickSavePath as jest.Mock).mockResolvedValue(null)
  await openDialog()
  await userEvent.click(await screen.findByRole("button", { name: b.saveFile }))
  await waitFor(() => expect(pickSavePath).toHaveBeenCalled())
  expect(writeTextFile).not.toHaveBeenCalled()
})

it("refuses an export with nothing selected", async () => {
  await openDialog()
  for (const label of [b.partPlan, b.partProfiles, b.partProviders, b.partFiles, b.partSettings]) {
    await userEvent.click(await screen.findByLabelText(label))
  }
  await userEvent.click(screen.getByRole("button", { name: b.saveFile }))
  await waitFor(() => expect(pickSavePath).not.toHaveBeenCalled())
  expect(writeTextFile).not.toHaveBeenCalled()
})
