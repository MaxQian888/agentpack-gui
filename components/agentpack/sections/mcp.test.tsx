jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/system", () => ({ openUrl: jest.fn() }))
jest.mock("@/lib/tauri/commands", () => ({
  // Claude config declares context7 (a catalog server) plus "my-custom" (a
  // user-added server not in the registry). Codex config is empty.
  readTextFile: jest.fn(async (path: string) =>
    path.includes(".claude.json")
      ? JSON.stringify({ mcpServers: { context7: {}, "my-custom": {} } })
      : ""
  ),
  writeTextFile: jest.fn(async () => undefined),
  runCommand: jest.fn(async () => 0),
}))

import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { RunnerProvider } from "../run/runner-context"
import { useAppStore } from "@/store/app-store"
import { openUrl } from "@/lib/tauri/system"
import { runCommand } from "@/lib/tauri/commands"
import { McpSection } from "./mcp"

const paths = {
  home: "/h",
  claudeConfig: "/h/.claude.json",
  codexConfig: "/h/.codex/config.toml",
  os: "mac",
} as never

beforeEach(() => {
  useAppStore.getState().resetPlan()
  useAppStore.setState({ paths, dryRun: false, panelOpen: false })
  ;(runCommand as jest.Mock).mockClear()
})

function renderMcp() {
  return render(
    <I18nProvider>
      <RunnerProvider>
        <McpSection />
      </RunnerProvider>
    </I18nProvider>
  )
}

it("entering a key stores it under the server id", async () => {
  renderMcp()
  const key = await screen.findByLabelText(/context7 CONTEXT7_API_KEY/i)
  await userEvent.type(key, "abc")
  expect(useAppStore.getState().plan.mcpKeys.context7).toBe("abc")
})

it("toggling a target adds the server to the plan", async () => {
  renderMcp()
  await userEvent.click(screen.getAllByRole("checkbox")[0])
  expect(useAppStore.getState().plan.mcps.length).toBeGreaterThan(0)
})

it("badges a server that's already configured on an agent", async () => {
  renderMcp()
  // context7 is configured only on Claude → "installed (claude)".
  expect(await screen.findByText(/✔ installed \(claude\)/)).toBeInTheDocument()
  // A server that's in neither config shows the not-installed badge.
  expect((await screen.findAllByText(/○ not installed/)).length).toBeGreaterThan(0)
})

it("renders category headers for the grouped catalog", async () => {
  renderMcp()
  expect(await screen.findByText("Memory & knowledge")).toBeInTheDocument()
  expect(screen.getByText("Search & docs")).toBeInTheDocument()
})

it("search narrows the list to matching servers", async () => {
  renderMcp()
  await screen.findByText(/Supermemory/)
  await userEvent.type(screen.getByPlaceholderText(/Search MCP servers/i), "context7")
  expect(screen.getByText("Context7")).toBeInTheDocument()
  expect(screen.queryByText(/Supermemory/)).not.toBeInTheDocument()
})

it("the Installed filter hides not-installed servers", async () => {
  renderMcp()
  await screen.findByText("Context7")
  await userEvent.click(screen.getByRole("button", { name: /^Installed$/i }))
  expect(screen.getByText("Context7")).toBeInTheDocument()
  expect(screen.queryByText(/Supermemory/)).not.toBeInTheDocument()
})

it("lists a user-added server under Custom with a remove action", async () => {
  renderMcp()
  const heading = await screen.findByText(/Custom & user-added/)
  const section = heading.closest("div")!.parentElement!
  expect(within(section).getByText("my-custom")).toBeInTheDocument()
  await userEvent.click(within(section).getByRole("button", { name: /Remove now/i }))
  await waitFor(() => expect(runCommand).toHaveBeenCalled())
  // Removes via `claude mcp remove my-custom` (custom is installed on Claude).
  const cmd = (runCommand as jest.Mock).mock.calls[0][0]
  expect(cmd.args).toEqual(["mcp", "remove", "my-custom", "--scope", "user"])
})

it("Remove now removes the server from an installed agent", async () => {
  renderMcp()
  const title = await screen.findByText("Context7")
  const card = title.closest(".p-4") as HTMLElement
  // context7 is installed on Claude — selecting Claude reveals the Remove action.
  await userEvent.click(within(card).getAllByRole("checkbox")[0])
  await userEvent.click(within(card).getByRole("button", { name: /Remove now/i }))
  await waitFor(() => expect(runCommand).toHaveBeenCalled())
  const cmd = (runCommand as jest.Mock).mock.calls[0][0]
  expect(cmd.args).toEqual(["mcp", "remove", "context7", "--scope", "user"])
})

it("Add now installs the selected server through the runner", async () => {
  renderMcp()
  await screen.findByText(/Supermemory/)
  // Select Claude for supermemory (first checkbox) — it isn't installed yet.
  await userEvent.click(screen.getAllByRole("checkbox")[0])
  await userEvent.click(screen.getByRole("button", { name: /Add now/i }))
  await waitFor(() => expect(runCommand).toHaveBeenCalled())
  expect(useAppStore.getState().panelOpen).toBe(true)
})

it("opens the docs link via the system opener", async () => {
  renderMcp()
  await screen.findByText("Context7")
  await userEvent.click(screen.getAllByRole("button", { name: /^Docs$/i })[0])
  expect(openUrl).toHaveBeenCalled()
})
