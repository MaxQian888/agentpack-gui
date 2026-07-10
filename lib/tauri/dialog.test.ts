const openMock = jest.fn()
jest.mock("@tauri-apps/plugin-dialog", () => ({ open: openMock }))
jest.mock("@/lib/tauri", () => ({ isTauri: jest.fn() }))

import { isTauri } from "@/lib/tauri"
import { pickFolder } from "./dialog"

describe("pickFolder", () => {
  it("returns null in web mode without touching the plugin", async () => {
    ;(isTauri as jest.Mock).mockReturnValue(false)
    expect(await pickFolder()).toBeNull()
    expect(openMock).not.toHaveBeenCalled()
  })

  it("returns the chosen directory path", async () => {
    ;(isTauri as jest.Mock).mockReturnValue(true)
    openMock.mockResolvedValue("C:\\skills\\my-skill")
    expect(await pickFolder()).toBe("C:\\skills\\my-skill")
    expect(openMock).toHaveBeenCalledWith({ directory: true, multiple: false })
  })

  it("returns null when the user cancels", async () => {
    ;(isTauri as jest.Mock).mockReturnValue(true)
    openMock.mockResolvedValue(null)
    expect(await pickFolder()).toBeNull()
  })
})
