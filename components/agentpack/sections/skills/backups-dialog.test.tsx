jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
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
import { deleteSkillBackup, listSkillBackups, restoreSkillBackup } from "@/lib/tauri/commands"
import { toast } from "sonner"
import { BackupsDialog } from "./backups-dialog"

const backup = {
  id: "web-design-1700000000000",
  name: "web-design",
  dirName: "web-design",
  source: "claude",
  bytes: 2048,
  createdAt: 1700000000000,
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(listSkillBackups as jest.Mock).mockResolvedValue([backup])
})

function renderDialog(refresh = jest.fn()) {
  render(
    <I18nProvider>
      <BackupsDialog open onOpenChange={jest.fn()} refresh={refresh} />
    </I18nProvider>
  )
  return refresh
}

it("shows the empty state when there are no backups", async () => {
  ;(listSkillBackups as jest.Mock).mockResolvedValue([])
  renderDialog()
  expect(await screen.findByText(en.skillsBrowser.backupsEmpty)).toBeInTheDocument()
})

it("lists backups and restores one into the chosen targets", async () => {
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

  await waitFor(() =>
    expect(restoreSkillBackup).toHaveBeenCalledWith("web-design-1700000000000", ["claude", "codex"])
  )
  expect(toast.success).toHaveBeenCalled()
  expect(refresh).toHaveBeenCalled()
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
