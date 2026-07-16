jest.mock("@/lib/tauri", () => ({ isTauri: jest.fn(() => true) }))
jest.mock("@/lib/tauri/commands", () => ({
  readTextFile: jest.fn(),
  commandOnPath: jest.fn(async () => true),
  probeHost: jest.fn(async () => ({ reachable: true, latencyMs: 12 })),
}))
jest.mock("@/lib/tauri/system", () => ({ openUrl: jest.fn() }))

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { commandOnPath, readTextFile } from "@/lib/tauri/commands"
import { openUrl } from "@/lib/tauri/system"
import { McpDetailDialog } from "./detail-dialog"
import type { DashboardScan } from "../dashboard"

// A Claude config on disk carrying both a catalog server and a custom one.
const CLAUDE = JSON.stringify({
  mcpServers: {
    context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"], env: {} },
    mine: { command: "node", args: ["server.js"], env: {} },
  },
})

const scan = (over: Partial<DashboardScan> = {}): DashboardScan =>
  ({
    claudeMcps: { known: [], custom: [] },
    codexMcps: { known: [], custom: [] },
    opencodeMcps: { known: [], custom: [] },
    claudeSkills: { known: [], custom: [] },
    codexSkills: { known: [], custom: [] },
    relay: { hasToken: false },
    hasCodexRelay: false,
    providers: [],
    claudeSettings: { status: "missing", hasBackup: false },
    codexConfig: { status: "missing", hasBackup: false },
    ...over,
  }) as DashboardScan

const paths = {
  home: "/h",
  claudeConfig: "/h/.claude.json",
  codexConfig: "/h/.codex/config.toml",
  opencodeConfig: "/h/.config/opencode/opencode.json",
} as never

beforeEach(() => {
  useAppStore.getState().resetPlan()
  useAppStore.setState({ paths })
  ;(readTextFile as jest.Mock).mockImplementation(async (p: string) =>
    p.includes(".claude.json") ? CLAUDE : "{}"
  )
  ;(openUrl as jest.Mock).mockClear()
  ;(commandOnPath as jest.Mock).mockClear()
  ;(commandOnPath as jest.Mock).mockResolvedValue(true)
})

function renderDialog(props: Partial<Parameters<typeof McpDetailDialog>[0]> = {}) {
  const onOpenChange = jest.fn()
  const onEdit = jest.fn()
  render(
    <I18nProvider>
      <McpDetailDialog
        id="context7"
        open
        onOpenChange={onOpenChange}
        scan={scan({ claudeMcps: { known: ["context7"], custom: [] } })}
        onEdit={onEdit}
        {...props}
      />
    </I18nProvider>
  )
  return { onOpenChange, onEdit }
}

it("renders nothing without a server id", () => {
  const { container } = render(
    <I18nProvider>
      <McpDetailDialog id={null} open onOpenChange={() => {}} scan={null} />
    </I18nProvider>
  )
  expect(container).toBeEmptyDOMElement()
})

it("shows the catalog badge and the parsed on-disk config, ✓ where absent", async () => {
  renderDialog({
    scan: scan({
      claudeMcps: { known: ["context7"], custom: [] },
      opencodeMcps: { known: ["context7"], custom: [] },
    }),
  })
  expect(await screen.findByText("Context7")).toBeInTheDocument()
  expect(screen.getByText("catalog")).toBeInTheDocument()
  // Claude parses to a spec (command shown as a field value); OpenCode's empty
  // "{}" config has no parseable entry, so it renders the ✓ fallback.
  expect(await screen.findByText(/npx -y @upstash\/context7-mcp/)).toBeInTheDocument()
  expect(screen.getByText("✓")).toBeInTheDocument()
})

it("runs a lightweight health check when Test is clicked", async () => {
  ;(commandOnPath as jest.Mock).mockResolvedValue(true)
  renderDialog()
  await screen.findByText("Context7")
  await userEvent.click(screen.getByRole("button", { name: "Test" }))
  await waitFor(() => expect(commandOnPath).toHaveBeenCalledWith("npx"))
  expect(await screen.findByText(/found on PATH/i)).toBeInTheDocument()
})

it("copies a field's real value to the clipboard", async () => {
  const writeText = jest.fn().mockResolvedValue(undefined)
  Object.assign(navigator, { clipboard: { writeText } })
  renderDialog()
  // Wait for the parsed spec fields (not just the header title) to render.
  await screen.findByText(/npx -y @upstash\/context7-mcp/)
  await userEvent.click(screen.getByRole("button", { name: /Copy Command/i }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("npx -y @upstash/context7-mcp"))
})

it("opens the docs link for a catalog server", async () => {
  renderDialog()
  await userEvent.click(await screen.findByRole("button", { name: /Docs/i }))
  expect(openUrl).toHaveBeenCalledWith("https://github.com/upstash/context7")
})

it("says not-configured when the server is present on no target", async () => {
  renderDialog({ scan: scan() })
  expect(await screen.findByText("Not configured on any agent yet.")).toBeInTheDocument()
})

it("offers Edit for a custom server and hands the reconstructed spec back", async () => {
  const { onOpenChange, onEdit } = renderDialog({
    id: "mine",
    scan: scan({ claudeMcps: { known: [], custom: ["mine"] } }),
  })
  await userEvent.click(await screen.findByRole("button", { name: /Edit/i }))
  expect(onEdit).toHaveBeenCalledTimes(1)
  const value = onEdit.mock.calls[0][0]
  expect(value.id).toBe("mine")
  expect(value.targets).toEqual(["claude"])
  expect(value.spec).toMatchObject({ transport: "stdio", command: "node" })
  expect(onOpenChange).toHaveBeenCalledWith(false)
})
