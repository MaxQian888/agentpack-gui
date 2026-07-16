jest.mock("@/lib/tauri", () => ({ isTauri: jest.fn() }))
jest.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: jest.fn(),
  revealItemInDir: jest.fn(),
  openPath: jest.fn(),
}))
jest.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: jest.fn(),
  requestPermission: jest.fn(),
  sendNotification: jest.fn(),
}))

import { isTauri } from "@/lib/tauri"
import {
  openUrl as opener,
  openPath as openPathPlugin,
  revealItemInDir,
} from "@tauri-apps/plugin-opener"
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification"
import { notify, openPath, openUrl, revealPath } from "./system"

const mockedIsTauri = isTauri as jest.Mock

beforeEach(() => {
  mockedIsTauri.mockReturnValue(true)
})

describe("openUrl", () => {
  it("uses window.open in web mode", async () => {
    mockedIsTauri.mockReturnValue(false)
    const win = jest.spyOn(window, "open").mockImplementation(() => null)
    await openUrl("https://example.com")
    expect(win).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer")
    expect(opener).not.toHaveBeenCalled()
    win.mockRestore()
  })

  it("uses the opener plugin under Tauri", async () => {
    await openUrl("https://example.com")
    expect(opener).toHaveBeenCalledWith("https://example.com")
  })
})

describe("revealPath", () => {
  it("no-ops in web mode", async () => {
    mockedIsTauri.mockReturnValue(false)
    await revealPath("/tmp/x")
    expect(revealItemInDir).not.toHaveBeenCalled()
  })

  it("reveals the path under Tauri", async () => {
    await revealPath("/tmp/x")
    expect(revealItemInDir).toHaveBeenCalledWith("/tmp/x")
  })
})

describe("openPath", () => {
  it("no-ops in web mode", async () => {
    mockedIsTauri.mockReturnValue(false)
    await openPath("/tmp/x/SKILL.md")
    expect(openPathPlugin).not.toHaveBeenCalled()
  })

  it("opens the file with the default app under Tauri", async () => {
    await openPath("/tmp/x/SKILL.md")
    expect(openPathPlugin).toHaveBeenCalledWith("/tmp/x/SKILL.md")
  })
})

describe("notify", () => {
  it("no-ops in web mode", async () => {
    mockedIsTauri.mockReturnValue(false)
    await notify("t", "b")
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it("sends when permission is already granted", async () => {
    ;(isPermissionGranted as jest.Mock).mockResolvedValue(true)
    await notify("t", "b")
    expect(requestPermission).not.toHaveBeenCalled()
    expect(sendNotification).toHaveBeenCalledWith({ title: "t", body: "b" })
  })

  it("requests permission first, then sends when granted", async () => {
    ;(isPermissionGranted as jest.Mock).mockResolvedValue(false)
    ;(requestPermission as jest.Mock).mockResolvedValue("granted")
    await notify("t", "b")
    expect(requestPermission).toHaveBeenCalled()
    expect(sendNotification).toHaveBeenCalled()
  })

  it("does not send when permission is denied", async () => {
    ;(isPermissionGranted as jest.Mock).mockResolvedValue(false)
    ;(requestPermission as jest.Mock).mockResolvedValue("denied")
    await notify("t", "b")
    expect(sendNotification).not.toHaveBeenCalled()
  })
})
