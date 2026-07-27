jest.mock("@/lib/tauri", () => ({ isTauri: jest.fn() }))
jest.mock("@/lib/tauri/window", () => ({ showAndFocusWindow: jest.fn() }))
jest.mock("@tauri-apps/plugin-global-shortcut", () => ({
  register: jest.fn(),
  unregister: jest.fn(),
  isRegistered: jest.fn(),
}))

import { isTauri } from "@/lib/tauri"
import { showAndFocusWindow } from "@/lib/tauri/window"
import { isRegistered, register, unregister } from "@tauri-apps/plugin-global-shortcut"
import {
  DEFAULT_SUMMON_SHORTCUT,
  registerSummonShortcut,
  unregisterSummonShortcut,
} from "./shortcut"

const mockedIsTauri = isTauri as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockedIsTauri.mockReturnValue(true)
  ;(isRegistered as jest.Mock).mockResolvedValue(false)
  ;(register as jest.Mock).mockResolvedValue(undefined)
  ;(unregister as jest.Mock).mockResolvedValue(undefined)
})

describe("registerSummonShortcut", () => {
  it("claims the accelerator and reports success", async () => {
    expect(await registerSummonShortcut(DEFAULT_SUMMON_SHORTCUT)).toBe(true)
    expect(register).toHaveBeenCalledWith(DEFAULT_SUMMON_SHORTCUT, expect.any(Function))
  })

  it("summons the window on press, and ignores the release event", async () => {
    await registerSummonShortcut(DEFAULT_SUMMON_SHORTCUT)
    const handler = (register as jest.Mock).mock.calls[0][1]
    handler({ state: "Released" })
    expect(showAndFocusWindow).not.toHaveBeenCalled()
    handler({ state: "Pressed" })
    expect(showAndFocusWindow).toHaveBeenCalled()
  })

  it("treats an accelerator this process already owns as success", async () => {
    ;(isRegistered as jest.Mock).mockResolvedValue(true)
    expect(await registerSummonShortcut(DEFAULT_SUMMON_SHORTCUT)).toBe(true)
    expect(register).not.toHaveBeenCalled()
  })

  it("reports failure when another app owns the accelerator", async () => {
    ;(register as jest.Mock).mockRejectedValue(new Error("HotKey already registered"))
    expect(await registerSummonShortcut(DEFAULT_SUMMON_SHORTCUT)).toBe(false)
  })

  it("reports failure in web mode without touching the plugin", async () => {
    mockedIsTauri.mockReturnValue(false)
    expect(await registerSummonShortcut(DEFAULT_SUMMON_SHORTCUT)).toBe(false)
    expect(register).not.toHaveBeenCalled()
  })
})

describe("unregisterSummonShortcut", () => {
  it("releases an accelerator it holds", async () => {
    ;(isRegistered as jest.Mock).mockResolvedValue(true)
    await unregisterSummonShortcut(DEFAULT_SUMMON_SHORTCUT)
    expect(unregister).toHaveBeenCalledWith(DEFAULT_SUMMON_SHORTCUT)
  })

  it("is a no-op when the accelerator was never registered", async () => {
    await unregisterSummonShortcut(DEFAULT_SUMMON_SHORTCUT)
    expect(unregister).not.toHaveBeenCalled()
  })

  it("swallows plugin errors", async () => {
    ;(isRegistered as jest.Mock).mockRejectedValue(new Error("gone"))
    await expect(unregisterSummonShortcut(DEFAULT_SUMMON_SHORTCUT)).resolves.toBeUndefined()
  })
})
