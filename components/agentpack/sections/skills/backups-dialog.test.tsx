jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), message: jest.fn() },
}))
jest.mock("@/lib/tauri/commands", () => ({
  listSkillBackups: jest.fn(),
  restoreSkillBackup: jest.fn(async () => ["/h/.claude/skills/web-design"]),
  deleteSkillBackup: jest.fn(async () => undefined),
}))

import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { useAppStore } from "@/store/app-store"
import { deleteSkillBackup, listSkillBackups, restoreSkillBackup } from "@/lib/tauri/commands"
import type { InstalledSkill } from "@/lib/skills/types"
import { toast } from "sonner"
import { RunnerHarness } from "../../run/__testing__/harness"
import { BackupsDialog } from "./backups-dialog"

const paths = {
  home: "/h",
  claudeSkillsDir: "/h/.claude/skills",
  codexSkillsDir: "/h/.codex/skills",
  opencodeSkillsDir: "/h/.config/opencode/skills",
  agentsSkillsDir: "/h/.agents/skills",
  os: "mac",
} as never

const backup = {
  id: "web-design-1700000000000",
  name: "web-design",
  dirName: "web-design",
  source: "claude",
  bytes: 2048,
  createdAt: 1700000000000,
}

beforeEach(() => {
  ;(listSkillBackups as jest.Mock).mockResolvedValue([backup])
  useAppStore.setState({ paths, panelOpen: false })
})

function renderDialog(refresh = jest.fn(), skills: InstalledSkill[] = []) {
  render(
    <I18nProvider>
      <RunnerHarness autoApply>
        <BackupsDialog open onOpenChange={jest.fn()} skills={skills} refresh={refresh} />
      </RunnerHarness>
    </I18nProvider>
  )
  return refresh
}

it("shows the empty state when there are no backups", async () => {
  ;(listSkillBackups as jest.Mock).mockResolvedValue([])
  renderDialog()
  expect(await screen.findByText(en.skillsBrowser.backupsEmpty)).toBeInTheDocument()
})

it("says the list couldn't be read — not that there are no backups — and retries", async () => {
  ;(listSkillBackups as jest.Mock).mockRejectedValueOnce("permission denied")
  renderDialog()
  expect(
    await screen.findByText(en.skillsBrowser.backupsLoadFailed("permission denied"))
  ).toBeInTheDocument()
  expect(screen.queryByText(en.skillsBrowser.backupsEmpty)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.retry }))
  expect(await screen.findByText("web-design")).toBeInTheDocument()
})

it("restores into the chosen targets through the review panel", async () => {
  const refresh = renderDialog()
  expect(await screen.findByText("web-design")).toBeInTheDocument()

  // Open the restore dialog (default target = the backed-up source).
  await userEvent.click(screen.getByRole("button", { name: new RegExp(en.skillsBrowser.restore) }))
  const dialog = await screen.findByRole("alertdialog")
  // Toggle a second target on before restoring.
  await userEvent.click(
    within(dialog).getByRole("checkbox", { name: en.skillsBrowser.sources.codex })
  )
  await userEvent.click(within(dialog).getByRole("button", { name: en.skillsBrowser.restore }))

  // Staged, not called directly: the panel opened, then the step ran.
  await waitFor(() =>
    expect(restoreSkillBackup).toHaveBeenCalledWith("web-design-1700000000000", ["claude", "codex"])
  )
  expect(useAppStore.getState().panelOpen).toBe(true)
  await waitFor(() => expect(refresh).toHaveBeenCalled())
})

it("asks before a restore overwrites a skill that is installed now", async () => {
  renderDialog(jest.fn(), [
    {
      source: "claude",
      dirName: "web-design",
      path: "/h/.claude/skills/web-design",
      isSymlink: false,
      linkTarget: null,
      skillMd: "---\nname: web-design\n---\n",
      modifiedAt: 0,
      origin: null,
    },
  ])
  expect(await screen.findByText("web-design")).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: new RegExp(en.skillsBrowser.restore) }))
  const dialog = await screen.findByRole("alertdialog")
  await userEvent.click(within(dialog).getByRole("button", { name: en.skillsBrowser.restore }))
  // The install guard, same as every other overwrite.
  expect(await screen.findByText(en.skillsBrowser.conflict.title)).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.conflict.cancel }))
  expect(restoreSkillBackup).not.toHaveBeenCalled()
})

it("deletes a backup after confirmation", async () => {
  renderDialog()
  expect(await screen.findByText("web-design")).toBeInTheDocument()

  await userEvent.click(
    screen.getByRole("button", { name: new RegExp(en.skillsBrowser.deleteBackup) })
  )
  const dialog = await screen.findByRole("alertdialog")
  await userEvent.click(
    within(dialog).getByRole("button", { name: en.skillsBrowser.confirmDelete })
  )

  await waitFor(() => expect(deleteSkillBackup).toHaveBeenCalledWith("web-design-1700000000000"))
  expect(toast.success).toHaveBeenCalled()
})
