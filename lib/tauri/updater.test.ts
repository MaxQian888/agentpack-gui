jest.mock("@/lib/tauri", () => ({ isTauri: jest.fn() }))
jest.mock("@tauri-apps/plugin-updater", () => ({ check: jest.fn() }))
jest.mock("@tauri-apps/plugin-process", () => ({ relaunch: jest.fn() }))
jest.mock("@tauri-apps/api/app", () => ({ getVersion: jest.fn() }))

import { isTauri } from "@/lib/tauri"
import { check } from "@tauri-apps/plugin-updater"
import { relaunch } from "@tauri-apps/plugin-process"
import { getVersion } from "@tauri-apps/api/app"
import { checkForUpdate, downloadAndInstallUpdate, getAppVersion, restartApp } from "./updater"

const mockedIsTauri = isTauri as jest.Mock
const mockedCheck = check as jest.Mock
const mockedGetVersion = getVersion as jest.Mock

beforeEach(() => {
  mockedIsTauri.mockReturnValue(true)
})

describe("getAppVersion", () => {
  it("returns null in web mode", async () => {
    mockedIsTauri.mockReturnValue(false)
    expect(await getAppVersion()).toBeNull()
    expect(mockedGetVersion).not.toHaveBeenCalled()
  })

  it("returns the bundle version under Tauri", async () => {
    mockedGetVersion.mockResolvedValue("1.2.3")
    expect(await getAppVersion()).toBe("1.2.3")
  })
})

describe("checkForUpdate", () => {
  it("returns null in web mode", async () => {
    mockedIsTauri.mockReturnValue(false)
    expect(await checkForUpdate()).toBeNull()
  })

  it("returns null when already up to date", async () => {
    mockedCheck.mockResolvedValue(null)
    expect(await checkForUpdate()).toBeNull()
  })

  it("maps the Update to plain metadata when one is available", async () => {
    mockedCheck.mockResolvedValue({
      version: "2.0.0",
      currentVersion: "1.0.0",
      date: "2026-01-01",
      body: "notes",
      downloadAndInstall: jest.fn(),
    })
    expect(await checkForUpdate()).toEqual({
      version: "2.0.0",
      currentVersion: "1.0.0",
      date: "2026-01-01",
      body: "notes",
    })
  })
})

describe("downloadAndInstallUpdate", () => {
  it("accumulates download progress into a 0–100 percentage", async () => {
    const downloadAndInstall = jest.fn(async (cb: (e: unknown) => void) => {
      cb({ event: "Started", data: { contentLength: 100 } })
      cb({ event: "Progress", data: { chunkLength: 40 } })
      cb({ event: "Progress", data: { chunkLength: 60 } })
      cb({ event: "Finished" })
    })
    mockedCheck.mockResolvedValue({
      version: "2.0.0",
      currentVersion: "1.0.0",
      downloadAndInstall,
    })
    await checkForUpdate()

    const progress: number[] = []
    await downloadAndInstallUpdate((pct) => progress.push(pct))

    expect(downloadAndInstall).toHaveBeenCalled()
    expect(progress).toEqual([0, 40, 100, 100])
  })

  it("throws when no update was found first", async () => {
    // An up-to-date check clears the held update handle.
    mockedCheck.mockResolvedValue(null)
    await checkForUpdate()
    await expect(downloadAndInstallUpdate(() => {})).rejects.toThrow(/check for updates/i)
  })
})

describe("restartApp", () => {
  it("no-ops in web mode", async () => {
    mockedIsTauri.mockReturnValue(false)
    await restartApp()
    expect(relaunch).not.toHaveBeenCalled()
  })

  it("relaunches under Tauri", async () => {
    await restartApp()
    expect(relaunch).toHaveBeenCalled()
  })
})
