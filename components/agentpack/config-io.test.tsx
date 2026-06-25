const saveDialog = jest.fn()
const openDialog = jest.fn()
jest.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...a: unknown[]) => saveDialog(...a),
  open: (...a: unknown[]) => openDialog(...a),
}))
jest.mock("@/lib/tauri", () => ({ isTauri: jest.fn(() => true) }))
jest.mock("@/lib/tauri/commands", () => ({
  writeTextFile: jest.fn(async () => undefined),
  readTextFile: jest.fn(async () => "{}"),
}))
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() },
}))

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"
import { isTauri } from "@/lib/tauri"
import { readTextFile, writeTextFile } from "@/lib/tauri/commands"
import { serializePlan } from "@/lib/agentpack/config"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { ConfigIO } from "./config-io"

beforeEach(() => {
  ;(isTauri as jest.Mock).mockReturnValue(true)
  useAppStore.getState().resetPlan()
})

function renderIO() {
  return render(
    <I18nProvider>
      <ConfigIO />
    </I18nProvider>
  )
}

const clickSave = () => userEvent.click(screen.getByRole("button", { name: /save config/i }))
const clickLoad = () => userEvent.click(screen.getByRole("button", { name: /load config/i }))

it("errors out of Tauri-only actions when not in Tauri", async () => {
  ;(isTauri as jest.Mock).mockReturnValue(false)
  renderIO()
  await clickSave()
  expect(toast.error).toHaveBeenCalled()
  expect(saveDialog).not.toHaveBeenCalled()
})

it("writes the serialized plan to the chosen path", async () => {
  saveDialog.mockResolvedValue("/tmp/agentpack.config.json")
  renderIO()
  await clickSave()
  expect(writeTextFile).toHaveBeenCalledWith(
    "/tmp/agentpack.config.json",
    serializePlan(useAppStore.getState().plan)
  )
  expect(toast.success).toHaveBeenCalled()
})

it("does nothing when the save dialog is cancelled", async () => {
  saveDialog.mockResolvedValue(null)
  renderIO()
  await clickSave()
  expect(writeTextFile).not.toHaveBeenCalled()
})

it("loads a valid config and applies it to the store", async () => {
  const plan = { ...useAppStore.getState().plan, clis: ["claude-code" as const] }
  openDialog.mockResolvedValue("/tmp/cfg.json")
  ;(readTextFile as jest.Mock).mockResolvedValue(serializePlan(plan))
  renderIO()
  await clickLoad()
  expect(useAppStore.getState().plan.clis).toEqual(["claude-code"])
  expect(toast.success).toHaveBeenCalled()
})

it("toasts an error for an invalid config file", async () => {
  openDialog.mockResolvedValue("/tmp/cfg.json")
  ;(readTextFile as jest.Mock).mockResolvedValue("{ not json")
  renderIO()
  await clickLoad()
  expect(toast.error).toHaveBeenCalled()
})

it("does nothing when the open dialog is cancelled", async () => {
  openDialog.mockResolvedValue(null)
  renderIO()
  await clickLoad()
  expect(readTextFile).not.toHaveBeenCalled()
})
