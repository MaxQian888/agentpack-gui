jest.mock("@/lib/tauri", () => ({ isTauri: jest.fn() }))
jest.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: jest.fn() }))
jest.mock("@tauri-apps/api/app", () => ({ show: jest.fn() }))

import { isTauri } from "@/lib/tauri"
import { show as showApp } from "@tauri-apps/api/app"
import { getCurrentWindow } from "@tauri-apps/api/window"
import {
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  onWindowResized,
  showAndFocusWindow,
  toggleMaximizeWindow,
} from "./window"

const mockedIsTauri = isTauri as jest.Mock
const unlisten = jest.fn()

const win = {
  minimize: jest.fn().mockResolvedValue(undefined),
  toggleMaximize: jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
  isMaximized: jest.fn().mockResolvedValue(true),
  onResized: jest.fn().mockResolvedValue(unlisten),
  unminimize: jest.fn().mockResolvedValue(undefined),
  show: jest.fn().mockResolvedValue(undefined),
  setFocus: jest.fn().mockResolvedValue(undefined),
}

beforeEach(() => {
  jest.clearAllMocks()
  mockedIsTauri.mockReturnValue(true)
  ;(getCurrentWindow as jest.Mock).mockReturnValue(win)
  ;(showApp as jest.Mock).mockResolvedValue(undefined)
})

it("drives the window controls under Tauri", async () => {
  await minimizeWindow()
  await toggleMaximizeWindow()
  await closeWindow()
  expect(win.minimize).toHaveBeenCalled()
  expect(win.toggleMaximize).toHaveBeenCalled()
  expect(win.close).toHaveBeenCalled()
})

it("no-ops every control in web mode", async () => {
  mockedIsTauri.mockReturnValue(false)
  await minimizeWindow()
  await toggleMaximizeWindow()
  await closeWindow()
  await showAndFocusWindow()
  expect(getCurrentWindow).not.toHaveBeenCalled()
})

it("reports the maximized state, and false in web mode", async () => {
  expect(await isWindowMaximized()).toBe(true)
  mockedIsTauri.mockReturnValue(false)
  expect(await isWindowMaximized()).toBe(false)
})

it("subscribes to resizes and hands back the unlisten fn", async () => {
  const handler = jest.fn()
  const off = await onWindowResized(handler)
  // Tauri passes a PhysicalSize payload the caller doesn't need — the wrapper
  // swallows it so callers can pass a zero-arg handler.
  ;(win.onResized as jest.Mock).mock.calls[0][0]({ payload: { width: 1, height: 2 } })
  expect(handler).toHaveBeenCalledWith()
  expect(off).toBe(unlisten)
})

it("returns a harmless unlisten fn in web mode", async () => {
  mockedIsTauri.mockReturnValue(false)
  const off = await onWindowResized(jest.fn())
  expect(() => off()).not.toThrow()
})

it("un-hides the app, then un-minimizes and un-hides the window, then focuses", async () => {
  await showAndFocusWindow()
  expect(showApp).toHaveBeenCalled()
  expect(win.unminimize).toHaveBeenCalled()
  expect(win.show).toHaveBeenCalled()
  expect(win.setFocus).toHaveBeenCalled()
})

it("still focuses the window when the app-level show is unavailable", async () => {
  // `show()` is macOS-only and rejects elsewhere; that must not abort the rest.
  ;(showApp as jest.Mock).mockRejectedValue(new Error("not implemented"))
  await showAndFocusWindow()
  expect(win.setFocus).toHaveBeenCalled()
})
