jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/commands", () => ({
  cleanupRoots: jest.fn(),
  cleanupScan: jest.fn(),
  cleanupApply: jest.fn(async () => ({
    quarantineId: "trash-1",
    bytes: 1_000,
    removed: 2,
    errors: [],
  })),
  cleanupQuarantineList: jest.fn(async () => []),
  cleanupQuarantineRestore: jest.fn(async () => ({ restored: 1, bytes: 10, errors: [] })),
  cleanupQuarantinePurge: jest.fn(async () => 1_000),
  isProcessRunning: jest.fn(async () => false),
  readTextFile: jest.fn(async () => "{}"),
  writeTextFile: jest.fn(async () => undefined),
  // `mergeFile` snapshots the original to `.agentpack.bak` before writing, and
  // asks this whether one already exists.
  pathExists: jest.fn(async () => false),
}))

import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { useAppStore } from "@/store/app-store"
import type { CleanupRoots, CleanupStat } from "@/lib/agentpack/cleanup"
import {
  cleanupApply,
  cleanupQuarantineList,
  cleanupQuarantinePurge,
  cleanupRoots,
  cleanupScan,
  isProcessRunning,
  readTextFile,
  writeTextFile,
} from "@/lib/tauri/commands"
import { RunnerHarness } from "../../run/__testing__/harness"
import { CleanupSection } from "./index"

const ROOTS: CleanupRoots = {
  home: "/h",
  claudeHome: "/h/.claude",
  claudeCacheDir: "/h/Library/Caches/claude-cli-nodejs",
  codexHome: "/h/.codex",
  opencodeDataDir: "/h/.local/share/opencode",
  opencodeConfigDir: "/h/.config/opencode",
  ccSwitchDir: "/h/.cc-switch",
  ccConnectDir: "/h/.cc-connect",
  copilotDir: "/h/.copilot",
  cursorDir: "/h/.cursor",
  agentpackDir: "/h/.agentpack",
}

const paths = {
  home: "/h",
  claudeSettings: "/h/.claude/settings.json",
  claudeConfig: "/h/.claude.json",
  os: "mac",
} as never

const mocked = {
  roots: cleanupRoots as jest.Mock,
  scan: cleanupScan as jest.Mock,
  apply: cleanupApply as jest.Mock,
  trash: cleanupQuarantineList as jest.Mock,
  purge: cleanupQuarantinePurge as jest.Mock,
  running: isProcessRunning as jest.Mock,
  read: readTextFile as jest.Mock,
  write: writeTextFile as jest.Mock,
}

/**
 * Answer the scan the way a real machine would: everything the catalog asked
 * about is absent except the ids named here. That mirrors production, where the
 * catalog is candidates and the scan is what decides which rows exist.
 */
function seedScan(present: Record<string, { bytes: number; files: number; degraded?: boolean }>) {
  mocked.roots.mockResolvedValue(ROOTS)
  mocked.scan.mockImplementation(async (specs: { id: string; path: string }[]) =>
    specs.map<CleanupStat>((spec) => {
      const hit = present[spec.id]
      return {
        id: spec.id,
        path: spec.path,
        exists: !!hit,
        bytes: hit?.bytes ?? 0,
        files: hit?.files ?? 0,
        newestMs: 0,
        oldestMs: 0,
        degraded: hit?.degraded ?? false,
      }
    })
  )
}

function renderSection(opts: { panel?: boolean } = {}) {
  // `panelOpen` is global: a panel left open by the previous test would render
  // this one's section behind a modal from the first paint.
  useAppStore.setState({ paths, panelOpen: false })
  return render(
    <I18nProvider>
      <RunnerHarness autoApply={!opts.panel} panel={opts.panel}>
        <CleanupSection />
      </RunnerHarness>
    </I18nProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mocked.trash.mockResolvedValue([])
  // Most tests do not exercise process detection. Keep that background probe
  // pending so it cannot update the component after a synchronous assertion;
  // the dedicated running-process test below supplies its own resolved result.
  mocked.running.mockImplementation(() => new Promise(() => {}))
  mocked.read.mockResolvedValue("{}")
  mocked.apply.mockResolvedValue({
    quarantineId: "trash-1",
    bytes: 1_000,
    removed: 2,
    errors: [],
  })
  seedScan({})
})

it("shows only what the scan found, with its measured size", async () => {
  seedScan({
    "codex-chats": { bytes: 2_000_000_000, files: 900 },
    "claude-cache": { bytes: 1_024, files: 3 },
  })
  renderSection()

  expect(await screen.findByText(en.cleanup.targets["codex-chats"].title)).toBeInTheDocument()
  expect(
    within(screen.getByRole("region", { name: en.cleanup.targetsPanel })).getByText("1.9 GB")
  ).toBeInTheDocument()
  expect(screen.getByText(en.cleanup.targets["claude-cache"].title)).toBeInTheDocument()
  // A catalog entry the scan says isn't there never reaches the screen.
  expect(screen.queryByText(en.cleanup.targets["opencode-chats"].title)).not.toBeInTheDocument()
})

it("says so plainly when there is nothing to clean", async () => {
  renderSection()
  expect(await screen.findByText(en.cleanup.empty)).toBeInTheDocument()
})

it("organizes measured cleanup targets, controls, and trash as one workbench", async () => {
  seedScan({ "claude-cache": { bytes: 1_024, files: 3 } })
  renderSection()
  await screen.findByText(en.cleanup.targets["claude-cache"].title)

  expect(screen.getByRole("region", { name: en.cleanup.summaryLabel })).toBeInTheDocument()
  expect(screen.getByRole("region", { name: en.cleanup.targetsPanel })).toBeInTheDocument()
  expect(screen.getByRole("complementary", { name: en.cleanup.actionsLabel })).toBeInTheDocument()
  expect(screen.getByRole("region", { name: en.cleanup.trashPanel })).toBeInTheDocument()
})

it("keeps disk metrics unmeasured and replaces the scan label while scanning", () => {
  mocked.scan.mockImplementation(() => new Promise(() => {}))
  renderSection()

  const summary = screen.getByRole("region", { name: en.cleanup.summaryLabel })
  expect(within(summary).getAllByText("—").length).toBeGreaterThanOrEqual(2)
  expect(screen.getByRole("button", { name: en.cleanup.scanning })).toBeDisabled()
})

it("hides stale disk totals while a changed filter is being measured", async () => {
  seedScan({ "claude-cache": { bytes: 1_024, files: 3 } })
  renderSection()
  await screen.findByText(en.cleanup.targets["claude-cache"].title)
  mocked.scan.mockImplementation(() => new Promise(() => {}))

  await userEvent.click(screen.getByRole("combobox", { name: en.cleanup.age.label }))
  await userEvent.click(await screen.findByRole("option", { name: en.cleanup.age.days(30) }))

  const summary = screen.getByRole("region", { name: en.cleanup.summaryLabel })
  expect(within(summary).getAllByText("—").length).toBeGreaterThanOrEqual(2)
})

it("does not turn a recycle-area read failure into a plausible zero", async () => {
  mocked.trash.mockRejectedValueOnce(new Error("permission denied"))
  renderSection()

  const summary = screen.getByRole("region", { name: en.cleanup.summaryLabel })
  expect(
    await within(summary).findByText(en.cleanup.metricReadFailed("permission denied"))
  ).toBeInTheDocument()
  const trashPanel = screen.getByRole("region", { name: en.cleanup.trashPanel })
  expect(within(trashPanel).getByRole("alert")).toHaveTextContent(
    en.cleanup.trash.loadFailed("permission denied")
  )
  expect(within(trashPanel).getByRole("button", { name: en.cleanup.trash.retry })).toBeEnabled()
})

it("keeps a failed disk scan explicit instead of reporting an empty machine", async () => {
  mocked.scan.mockRejectedValueOnce(new Error("permission denied"))
  renderSection()

  expect(await screen.findByRole("alert")).toHaveTextContent(
    en.cleanup.scanFailed("permission denied")
  )
  const summary = screen.getByRole("region", { name: en.cleanup.summaryLabel })
  expect(within(summary).getAllByText("—").length).toBeGreaterThanOrEqual(2)
  expect(screen.queryByText(en.cleanup.empty)).not.toBeInTheDocument()
})

/**
 * The section's single most important behaviour. A quick-clean that also ticks
 * chat history would train people to click past the one screen here that matters.
 */
it("ticks only regenerated data in the quick clean, never records", async () => {
  seedScan({
    "codex-chats": { bytes: 2_000_000_000, files: 900 },
    "claude-cache": { bytes: 1_024, files: 3 },
  })
  renderSection()
  await screen.findByText(en.cleanup.targets["claude-cache"].title)

  await userEvent.click(screen.getByRole("button", { name: en.cleanup.quickClean }))

  const boxes = screen.getAllByRole("checkbox")
  const byName = (title: string) =>
    boxes.find((b) => b.closest("label")?.textContent?.includes(title))
  expect(byName(en.cleanup.targets["claude-cache"].title)).toBeChecked()
  expect(byName(en.cleanup.targets["codex-chats"].title)).not.toBeChecked()
})

it("adds the caches to what is already ticked, and says what it selects", async () => {
  seedScan({
    "codex-chats": { bytes: 2_000_000_000, files: 900 },
    "claude-cache": { bytes: 1_024, files: 3 },
  })
  renderSection()
  await screen.findByText(en.cleanup.targets["claude-cache"].title)
  const boxes = screen.getAllByRole("checkbox")
  const byName = (title: string) =>
    boxes.find((b) => b.closest("label")?.textContent?.includes(title))!

  await userEvent.click(byName(en.cleanup.targets["codex-chats"].title))
  const quick = screen.getByRole("button", { name: en.cleanup.quickClean })
  expect(quick).toHaveAccessibleDescription(en.cleanup.quickCleanHint)
  await userEvent.click(quick)

  // A deliberate pick survives the quick action rather than being replaced by it.
  expect(byName(en.cleanup.targets["codex-chats"].title)).toBeChecked()
  expect(byName(en.cleanup.targets["claude-cache"].title)).toBeChecked()
})

it("disables the quick action with a reason when nothing regenerated was found", async () => {
  seedScan({ "codex-chats": { bytes: 500, files: 5 } })
  renderSection()
  await screen.findByText(en.cleanup.targets["codex-chats"].title)

  const quick = screen.getByRole("button", { name: en.cleanup.quickClean })
  expect(quick).toBeDisabled()
  expect(quick).toHaveAccessibleDescription(en.cleanup.quickCleanNone)
})

/**
 * Invariant 5 of the app: every write goes through the review panel. A cleanup
 * that deleted on click would be the one destructive path with no gate.
 */
it("writes nothing until the review panel is applied", async () => {
  seedScan({ "claude-cache": { bytes: 1_024, files: 3 } })
  renderSection({ panel: true })
  await screen.findByText(en.cleanup.targets["claude-cache"].title)

  await userEvent.click(screen.getByRole("button", { name: en.cleanup.quickClean }))
  await userEvent.click(screen.getByRole("button", { name: en.cleanup.clean }))

  // Staged, not run.
  expect(mocked.apply).not.toHaveBeenCalled()
  await userEvent.click(await screen.findByRole("button", { name: en.review.apply }))
  await waitFor(() => expect(mocked.apply).toHaveBeenCalled())
})

it("keeps the selection when the review panel is discarded", async () => {
  seedScan({ "claude-cache": { bytes: 1_024, files: 3 } })
  renderSection({ panel: true })
  await screen.findByText(en.cleanup.targets["claude-cache"].title)
  await userEvent.click(screen.getByRole("checkbox"))
  const scansBefore = mocked.scan.mock.calls.length

  await userEvent.click(screen.getByRole("button", { name: en.cleanup.clean }))
  await userEvent.click(await screen.findByRole("button", { name: en.review.discard }))

  // Nothing moved, so what the user built is still exactly what they meant —
  // and the numbers on screen are still true, so nothing is re-measured.
  await waitFor(() => expect(screen.getByRole("checkbox")).toBeChecked())
  expect(mocked.apply).not.toHaveBeenCalled()
  expect(mocked.scan.mock.calls.length).toBe(scansBefore)
})

it("ignores a slower scan for a filter the user has already moved off", async () => {
  renderSection()
  await screen.findByText(en.cleanup.empty)

  // Hold every scan so two filter changes in a row can land out of order.
  const held: ((present: boolean) => void)[] = []
  mocked.scan.mockImplementation(
    (specs: { id: string; path: string }[]) =>
      new Promise<CleanupStat[]>((resolve) =>
        held.push((present) =>
          resolve(
            specs.map((spec) => {
              const hit = present && spec.id === "claude-cache"
              return {
                id: spec.id,
                path: spec.path,
                exists: hit,
                bytes: hit ? 5_000_000 : 0,
                files: hit ? 7 : 0,
                newestMs: 0,
                oldestMs: 0,
                degraded: false,
              }
            })
          )
        )
      )
  )
  const pick = async (days: number) => {
    await userEvent.click(screen.getByRole("combobox", { name: en.cleanup.age.label }))
    await userEvent.click(await screen.findByRole("option", { name: en.cleanup.age.days(days) }))
  }
  await pick(30)
  await waitFor(() => expect(held).toHaveLength(1))
  await pick(90)
  await waitFor(() => expect(held).toHaveLength(2))

  // The 90-day answer lands first; the stale 30-day one lands after it and
  // must not replace it — nor end the "measuring" state on its own.
  const settle = (answer: () => void) =>
    act(async () => {
      answer()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  await settle(() => held[1](false))
  const panel = screen.getByRole("region", { name: en.cleanup.targetsPanel })
  expect(within(panel).getByText(en.cleanup.empty)).toBeInTheDocument()
  await settle(() => held[0](true))
  expect(screen.queryByText(en.cleanup.targets["claude-cache"].title)).not.toBeInTheDocument()
  expect(within(panel).getByText(en.cleanup.empty)).toBeInTheDocument()
})

it("measures nothing stale into the review while a newer scan is still out", async () => {
  seedScan({ "claude-cache": { bytes: 1_024, files: 3 } })
  renderSection()
  await screen.findByText(en.cleanup.targets["claude-cache"].title)
  await userEvent.click(screen.getByRole("checkbox"))

  mocked.scan.mockImplementation(() => new Promise(() => {}))
  await userEvent.click(screen.getByRole("combobox", { name: en.cleanup.age.label }))
  await userEvent.click(await screen.findByRole("option", { name: en.cleanup.age.days(30) }))

  // Sizes on screen were measured under the old filter, so Clean waits.
  expect(screen.getByRole("button", { name: en.cleanup.clean })).toBeDisabled()
})

it("cleans the selection in the chosen mode, with the age filter applied", async () => {
  seedScan({ "claude-chats": { bytes: 500, files: 5 } })
  renderSection()
  await screen.findByText(en.cleanup.targets["claude-chats"].title)

  await userEvent.click(screen.getByRole("checkbox"))
  await userEvent.click(screen.getByRole("combobox", { name: en.cleanup.age.label }))
  await userEvent.click(await screen.findByRole("option", { name: en.cleanup.age.days(30) }))
  await userEvent.click(screen.getByRole("button", { name: en.cleanup.clean }))

  await waitFor(() => expect(mocked.apply).toHaveBeenCalled())
  const [specs, mode] = mocked.apply.mock.calls[0]
  expect(mode).toBe("quarantine")
  expect(specs).toEqual([{ id: "claude-chats", path: "/h/.claude/projects", olderThanDays: 30 }])
})

it("switches to a permanent delete when asked", async () => {
  seedScan({ "claude-cache": { bytes: 500, files: 5 } })
  renderSection()
  await screen.findByText(en.cleanup.targets["claude-cache"].title)

  await userEvent.click(screen.getByRole("combobox", { name: en.cleanup.mode.label }))
  await userEvent.click(await screen.findByRole("option", { name: en.cleanup.mode.delete }))
  expect(screen.getByText(en.cleanup.mode.deleteHint, { exact: false })).toBeInTheDocument()

  await userEvent.click(screen.getByRole("checkbox"))
  await userEvent.click(screen.getByRole("button", { name: en.cleanup.clean }))
  await waitFor(() => expect(mocked.apply).toHaveBeenCalled())
  expect(mocked.apply.mock.calls[0][1]).toBe("delete")
})

/**
 * Hooks are a key inside settings.json, not a file. Removing them has to ride
 * `mergeFile` — the path that backs the original up first — or clearing hooks
 * would take the user's model, permissions and status line with it.
 */
it("offers hooks only when settings.json has some, and clears just that key", async () => {
  mocked.read.mockImplementation(async (path: string) =>
    path === "/h/.claude/settings.json"
      ? JSON.stringify({ model: "opus", hooks: { PreToolUse: [{}] } })
      : "{}"
  )
  renderSection()

  const hooks = await screen.findByText(en.cleanup.targets["claude-hooks"].title)
  expect(hooks).toBeInTheDocument()

  await userEvent.click(screen.getByRole("checkbox"))
  await userEvent.click(screen.getByRole("button", { name: en.cleanup.clean }))

  await waitFor(() => expect(mocked.write).toHaveBeenCalled())
  // A cleanup step would have moved the whole file; this is a config merge.
  expect(mocked.apply).not.toHaveBeenCalled()
  const written = mocked.write.mock.calls.find(([p]: [string]) => p === "/h/.claude/settings.json")
  expect(JSON.parse(written![1])).toEqual({ model: "opus" })
})

it("hides the hooks row when there are none to clear", async () => {
  mocked.read.mockResolvedValue(JSON.stringify({ model: "opus" }))
  renderSection()
  await screen.findByText(en.cleanup.empty)
  expect(screen.queryByText(en.cleanup.targets["claude-hooks"].title)).not.toBeInTheDocument()
})

/**
 * A running CLI holds its database open, so cleaning underneath it silently
 * skips files. The user has to be told before pressing the button, not after.
 */
it("warns while the agent is running", async () => {
  seedScan({ "codex-chats": { bytes: 500, files: 5 } })
  mocked.running.mockImplementation(async (name: string) => name === "codex")
  renderSection()
  expect(await screen.findByText(en.cleanup.running("Codex"))).toBeInTheDocument()
})

/** A size that couldn't be fully read is a floor, and must never read as a total. */
it("marks a partially readable target rather than quoting its size as final", async () => {
  seedScan({ "claude-cache": { bytes: 100, files: 1, degraded: true } })
  renderSection()
  expect(await screen.findByText(en.cleanup.degraded)).toBeInTheDocument()
})

it("asks before emptying one batch, naming its size", async () => {
  mocked.trash.mockResolvedValue([
    { id: "trash-1", ts: 1, bytes: 2_048, items: 4, targetIds: ["claude-cache"] },
  ])
  renderSection()
  const trashPanel = screen.getByRole("region", { name: en.cleanup.trashPanel })
  await userEvent.click(
    await within(trashPanel).findByRole("button", { name: en.cleanup.trash.purge })
  )

  // The batch is the only copy of what it holds: nothing goes on the first click.
  const dialog = await screen.findByRole("alertdialog")
  expect(within(dialog).getByText(en.cleanup.trash.purgeBatchConfirmTitle)).toBeInTheDocument()
  expect(within(dialog).getByText(en.cleanup.trash.purgeConfirmBody("2.0 KB"))).toBeInTheDocument()
  expect(mocked.purge).not.toHaveBeenCalled()

  await userEvent.click(within(dialog).getByRole("button", { name: en.cleanup.trash.purge }))
  await waitFor(() => expect(mocked.purge).toHaveBeenCalledWith("trash-1"))
})

it("re-measures the targets after a batch is put back", async () => {
  mocked.trash.mockResolvedValue([
    { id: "trash-1", ts: 1, bytes: 2_048, items: 4, targetIds: ["claude-cache"] },
  ])
  renderSection()
  const restore = await screen.findByRole("button", { name: en.cleanup.trash.restore })
  const scansBefore = mocked.scan.mock.calls.length

  // What was put back is on disk again, so "Reclaimable" has to count it.
  seedScan({ "claude-cache": { bytes: 2_048, files: 4 } })
  await userEvent.click(restore)

  await waitFor(() => expect(mocked.scan.mock.calls.length).toBeGreaterThan(scansBefore))
  const targets = screen.getByRole("region", { name: en.cleanup.targetsPanel })
  expect(
    await within(targets).findByText(en.cleanup.targets["claude-cache"].title)
  ).toBeInTheDocument()
})

it("shows what the recycle area is holding", async () => {
  mocked.trash.mockResolvedValue([
    { id: "trash-1", ts: 1, bytes: 2_048, items: 4, targetIds: ["claude-cache"] },
  ])
  renderSection()
  expect(await screen.findByText(en.cleanup.trash.holding("2.0 KB", 1))).toBeInTheDocument()
  expect(screen.getByRole("button", { name: en.cleanup.trash.restore })).toBeInTheDocument()
})
