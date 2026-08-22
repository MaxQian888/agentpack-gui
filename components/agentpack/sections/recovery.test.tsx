const tauri = { value: true }
jest.mock("@/lib/tauri", () => ({ isTauri: () => tauri.value }))
jest.mock("@/lib/tauri/commands", () => ({
  backupList: jest.fn(async () => []),
  listSkillBackups: jest.fn(async () => []),
  cleanupQuarantineList: jest.fn(async () => []),
  fileStat: jest.fn(async () => ({ exists: false, bytes: 0, modifiedMs: 0 })),
  backupRestore: jest.fn(async () => ({
    restoredPaths: ["/h/db"],
    safetySnapshotId: "snapshot-safety",
  })),
  readTextFile: jest.fn(async () => "{}"),
  writeTextFile: jest.fn(async () => undefined),
}))
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() },
}))

import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { useAppStore } from "@/store/app-store"
import {
  backupList,
  backupRestore,
  cleanupQuarantineList,
  fileStat,
  listSkillBackups,
  readTextFile,
  writeTextFile,
} from "@/lib/tauri/commands"
import { toast } from "sonner"
import { RecoverySection } from "./recovery"
import { RunnerHarness } from "../run/__testing__/harness"
import type { DashboardScan } from "./dashboard"

const r = en.recoveryCentre
const HOUR = 3_600_000
const NOON = 1_700_000_000_000

const PATHS = {
  claudeSettings: "/h/.claude/settings.json",
  codexConfig: "/h/.codex/config.toml",
} as const

const scanWith = (over: Partial<DashboardScan> = {}): DashboardScan =>
  ({
    claudeMcps: { known: [], custom: [] },
    codexMcps: { known: [], custom: [] },
    opencodeMcps: { known: [], custom: [] },
    claudeSkills: { known: [], custom: [] },
    codexSkills: { known: [], custom: [] },
    relay: { hasToken: false },
    hasCodexRelay: false,
    providers: [],
    claudeSettings: { status: "ok", hasBackup: false },
    codexConfig: { status: "ok", hasBackup: false },
    at: NOON,
    degraded: false,
    ...over,
  }) as DashboardScan

beforeEach(() => {
  tauri.value = true
  jest.clearAllMocks()
  useAppStore.setState({ paths: PATHS as never })
  ;(backupList as jest.Mock).mockResolvedValue([])
  ;(listSkillBackups as jest.Mock).mockResolvedValue([])
  ;(cleanupQuarantineList as jest.Mock).mockResolvedValue([])
  ;(fileStat as jest.Mock).mockResolvedValue({ exists: false, bytes: 0, modifiedMs: 0 })
  ;(backupRestore as jest.Mock).mockResolvedValue({
    restoredPaths: ["/h/db"],
    safetySnapshotId: "snapshot-safety",
  })
})

const SNAPSHOT = {
  id: "snap",
  ts: NOON,
  reason: "before switch",
  files: [{ originalPath: "/h/db" }],
}

function renderSection(
  scan: DashboardScan | null = scanWith(),
  opts: { onNavigate?: (s: string) => void; autoApply?: boolean } = {}
) {
  render(
    <I18nProvider>
      <RunnerHarness autoApply={opts.autoApply ?? false}>
        <RecoverySection scan={scan} onNavigate={opts.onNavigate as never} />
      </RunnerHarness>
    </I18nProvider>
  )
}

const rows = () => screen.getByRole("region", { name: r.listPanel }).querySelectorAll("li")

it("says the desktop app is needed rather than showing an empty list", async () => {
  tauri.value = false
  renderSection()
  expect(await screen.findByText(r.notTauri)).toBeInTheDocument()
  // Unmeasured facts are em dashes, never a plausible-looking zero.
  const band = screen.getByRole("region", { name: r.summaryLabel })
  expect(within(band).getAllByText("—").length).toBeGreaterThan(0)
  expect(backupList).not.toHaveBeenCalled()
})

it("folds all four sources into one list, newest first", async () => {
  ;(backupList as jest.Mock).mockResolvedValue([
    { id: "snap", ts: NOON, reason: "before switch", files: [{ originalPath: "/h/db" }] },
  ])
  ;(listSkillBackups as jest.Mock).mockResolvedValue([
    { id: "sk", name: "code-review", dirName: "code-review", source: "claude", bytes: 1, createdAt: NOON - HOUR }, // prettier-ignore
  ])
  ;(cleanupQuarantineList as jest.Mock).mockResolvedValue([
    { id: "batch", ts: NOON - 2 * HOUR, bytes: 9, items: 3, targetIds: ["codex-logs"] },
  ])
  renderSection(scanWith({ claudeSettings: { status: "ok", hasBackup: true } }))

  await waitFor(() => expect(rows()).toHaveLength(4))
  const kinds = [...rows()].map((row) => row.textContent ?? "")
  expect(kinds[0]).toContain(r.kind.configSnapshot)
  expect(kinds[1]).toContain(r.kind.skillBackup)
  expect(kinds[2]).toContain(r.kind.quarantineBatch)
  // The config .bak came back undated from the stat mock, so it sorts last.
  expect(kinds[3]).toContain(r.kind.configBackupFile)
})

it("warns when a restore would write over something newer", async () => {
  // The dangerous case: the file was edited by hand after the backup was taken.
  ;(backupList as jest.Mock).mockResolvedValue([
    { id: "snap", ts: NOON, reason: "before switch", files: [{ originalPath: "/h/db" }] },
  ])
  ;(fileStat as jest.Mock).mockResolvedValue({ exists: true, bytes: 1, modifiedMs: NOON + HOUR })
  renderSection()

  expect(await screen.findByText(r.safety.stale)).toBeInTheDocument()
  expect(screen.getByText(r.safetyHint.stale)).toBeInTheDocument()
})

it("calls it safe when the live file is older than the backup", async () => {
  ;(backupList as jest.Mock).mockResolvedValue([
    { id: "snap", ts: NOON, reason: "before switch", files: [{ originalPath: "/h/db" }] },
  ])
  ;(fileStat as jest.Mock).mockResolvedValue({ exists: true, bytes: 1, modifiedMs: NOON - HOUR })
  renderSection()
  expect(await screen.findByText(r.safety.safe)).toBeInTheDocument()
})

it("says it can't tell rather than claiming there is nothing to lose", async () => {
  // An mtime the platform wouldn't report is not "1970, therefore older".
  ;(backupList as jest.Mock).mockResolvedValue([
    { id: "snap", ts: NOON, reason: "before switch", files: [{ originalPath: "/h/db" }] },
  ])
  ;(fileStat as jest.Mock).mockResolvedValue({ exists: true, bytes: 1, modifiedMs: 0 })
  renderSection()
  expect(await screen.findByText(r.safety.unknown)).toBeInTheDocument()
})

it("trusts a quarantine batch without measuring anything", async () => {
  // Its own restore command refuses to overwrite a reoccupied path, so warning
  // about it would train people to ignore the warning that matters.
  ;(cleanupQuarantineList as jest.Mock).mockResolvedValue([
    { id: "batch", ts: NOON, bytes: 9, items: 3, targetIds: [] },
  ])
  renderSection()
  expect(await screen.findByText(r.safety.safe)).toBeInTheDocument()
  expect(fileStat).not.toHaveBeenCalled()
})

it("dates a config backup from its own sibling, which is what makes a warning possible", async () => {
  ;(fileStat as jest.Mock).mockImplementation(async (path: string) =>
    path.endsWith(".agentpack.bak")
      ? { exists: true, bytes: 1, modifiedMs: NOON }
      : { exists: true, bytes: 1, modifiedMs: NOON + HOUR }
  )
  renderSection(scanWith({ claudeSettings: { status: "ok", hasBackup: true } }))
  // Dated from the .bak, then measured against the live file: stale, not "can't tell".
  expect(await screen.findByText(r.safety.stale)).toBeInTheDocument()
})

it("offers no restore point for a config that never had a backup", async () => {
  renderSection(scanWith())
  expect(await screen.findByText(r.empty)).toBeInTheDocument()
})

it("says the list may be short when a store couldn't be read", async () => {
  // "You have no skill backups" and "we couldn't open the store" are not the
  // same screen, and only one of them means what it says.
  ;(listSkillBackups as jest.Mock).mockRejectedValue(new Error("EACCES"))
  ;(backupList as jest.Mock).mockResolvedValue([{ id: "snap", ts: NOON, reason: "x", files: [] }])
  renderSection()
  expect(await screen.findByText(r.degradedNote)).toBeInTheDocument()
  // The store that did open is still listed.
  expect(rows()).toHaveLength(1)
})

it("re-reads every source on request", async () => {
  renderSection()
  // Wait for the first read to settle: while it is in flight the button is
  // labelled "Reading…", which is a different control by name.
  await userEvent.click(await screen.findByRole("button", { name: r.refresh }))
  await waitFor(() => expect(backupList).toHaveBeenCalledTimes(2))
  expect(listSkillBackups).toHaveBeenCalledTimes(2)
  expect(cleanupQuarantineList).toHaveBeenCalledTimes(2)
})

describe("restoring", () => {
  it("stages a snapshot restore through the review panel, like every other write", async () => {
    ;(backupList as jest.Mock).mockResolvedValue([SNAPSHOT])
    ;(fileStat as jest.Mock).mockResolvedValue({ exists: true, bytes: 1, modifiedMs: NOON - HOUR })
    renderSection(scanWith(), { autoApply: true })

    await userEvent.click(await screen.findByRole("button", { name: r.restore }))
    await waitFor(() => expect(backupRestore).toHaveBeenCalledWith("snap"))
  })

  it("re-reads afterwards, because a restore moves the mtimes it was judged against", async () => {
    ;(backupList as jest.Mock).mockResolvedValue([SNAPSHOT])
    ;(fileStat as jest.Mock).mockResolvedValue({ exists: true, bytes: 1, modifiedMs: NOON - HOUR })
    renderSection(scanWith(), { autoApply: true })

    await userEvent.click(await screen.findByRole("button", { name: r.restore }))
    await waitFor(() => expect(backupList).toHaveBeenCalledTimes(2))
  })

  it("asks first when the restore would overwrite newer work", async () => {
    ;(backupList as jest.Mock).mockResolvedValue([SNAPSHOT])
    ;(fileStat as jest.Mock).mockResolvedValue({ exists: true, bytes: 1, modifiedMs: NOON + HOUR })
    renderSection(scanWith(), { autoApply: true })

    await userEvent.click(await screen.findByRole("button", { name: r.restore }))
    expect(await screen.findByText(r.confirmTitle)).toBeInTheDocument()
    // Nothing staged yet: the confirmation is a gate, not a notice.
    expect(backupRestore).not.toHaveBeenCalled()
  })

  it("stages nothing when the confirmation is declined", async () => {
    ;(backupList as jest.Mock).mockResolvedValue([SNAPSHOT])
    ;(fileStat as jest.Mock).mockResolvedValue({ exists: true, bytes: 1, modifiedMs: NOON + HOUR })
    renderSection(scanWith(), { autoApply: true })

    await userEvent.click(await screen.findByRole("button", { name: r.restore }))
    await userEvent.click(await screen.findByRole("button", { name: en.shell.cancel }))
    expect(backupRestore).not.toHaveBeenCalled()
  })

  it("goes ahead once the confirmation is given, and the panel still gates it", async () => {
    ;(backupList as jest.Mock).mockResolvedValue([SNAPSHOT])
    ;(fileStat as jest.Mock).mockResolvedValue({ exists: true, bytes: 1, modifiedMs: NOON + HOUR })
    renderSection(scanWith(), { autoApply: true })

    await userEvent.click(await screen.findByRole("button", { name: r.restore }))
    await userEvent.click(await screen.findByRole("button", { name: r.confirmProceed }))
    await waitFor(() => expect(backupRestore).toHaveBeenCalledWith("snap"))
  })

  it("restores a config backup by putting its .bak sibling back", async () => {
    // The other panel-routed kind: `fileRestoreStep` takes the live path and
    // appends the suffix itself, which is why the point carries the live path.
    ;(fileStat as jest.Mock).mockImplementation(async (path: string) =>
      path.endsWith(".agentpack.bak")
        ? { exists: true, bytes: 1, modifiedMs: NOON }
        : { exists: true, bytes: 1, modifiedMs: NOON - HOUR }
    )
    renderSection(scanWith({ claudeSettings: { status: "ok", hasBackup: true } }), {
      autoApply: true,
    })

    await userEvent.click(await screen.findByRole("button", { name: r.restore }))
    await waitFor(() =>
      expect(readTextFile).toHaveBeenCalledWith(`${PATHS.claudeSettings}.agentpack.bak`)
    )
    expect(writeTextFile).toHaveBeenCalledWith(PATHS.claudeSettings, "{}")
  })

  it("says so and does not re-read when the restore itself failed", async () => {
    ;(backupList as jest.Mock).mockResolvedValue([SNAPSHOT])
    ;(fileStat as jest.Mock).mockResolvedValue({ exists: true, bytes: 1, modifiedMs: NOON - HOUR })
    ;(backupRestore as jest.Mock).mockRejectedValue(new Error("EACCES"))
    renderSection(scanWith(), { autoApply: true })

    await userEvent.click(await screen.findByRole("button", { name: r.restore }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(r.restoreFailed))
    // Nothing changed on disk, so the readings on screen are still true.
    expect(backupList).toHaveBeenCalledTimes(1)
  })

  it("does not ask twice for a restore that loses nothing", async () => {
    // Asking on every restore would teach people to click through both gates.
    ;(backupList as jest.Mock).mockResolvedValue([SNAPSHOT])
    ;(fileStat as jest.Mock).mockResolvedValue({ exists: true, bytes: 1, modifiedMs: NOON - HOUR })
    renderSection(scanWith(), { autoApply: true })

    await userEvent.click(await screen.findByRole("button", { name: r.restore }))
    expect(screen.queryByText(r.confirmTitle)).not.toBeInTheDocument()
  })
})

describe("the two restores this page hands off", () => {
  const skillBackup = {
    id: "sk",
    name: "code-review",
    dirName: "code-review",
    source: "claude",
    bytes: 1,
    createdAt: NOON,
  }

  it("sends a skill backup to Skills, which is where the targets are chosen", async () => {
    // `restoreSkillBackup` needs the list of agents to restore *into*, and a
    // button here that silently picked one would be this page deciding
    // something the user hasn't.
    const onNavigate = jest.fn()
    ;(listSkillBackups as jest.Mock).mockResolvedValue([skillBackup])
    renderSection(scanWith(), { onNavigate })

    await userEvent.click(await screen.findByRole("button", { name: r.restoreIn(en.menu.skills) }))
    expect(onNavigate).toHaveBeenCalledWith("skills")
    expect(screen.getByText(r.handOffSkill)).toBeInTheDocument()
  })

  it("sends a quarantine batch to Clean up, where its contents can be read", async () => {
    const onNavigate = jest.fn()
    ;(cleanupQuarantineList as jest.Mock).mockResolvedValue([
      { id: "batch", ts: NOON, bytes: 9, items: 3, targetIds: [] },
    ])
    renderSection(scanWith(), { onNavigate })

    await userEvent.click(await screen.findByRole("button", { name: r.restoreIn(en.menu.cleanup) }))
    expect(onNavigate).toHaveBeenCalledWith("cleanup")
  })

  it("draws no hand-off button when there is nowhere wired up to send anyone", async () => {
    ;(listSkillBackups as jest.Mock).mockResolvedValue([skillBackup])
    renderSection()
    expect(await screen.findByText(r.handOffSkill)).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: r.restoreIn(en.menu.skills) })
    ).not.toBeInTheDocument()
  })
})
