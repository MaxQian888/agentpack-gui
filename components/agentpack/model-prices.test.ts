jest.mock("@/lib/tauri/pricing", () => ({
  downloadPrices: jest.fn(),
  loadCachedPrices: jest.fn(),
}))

import { downloadPrices, loadCachedPrices } from "@/lib/tauri/pricing"
import { priceForModel, setSyncedPrices } from "@/lib/history/pricing"
import { SYNC_INTERVAL_MS, type SyncedPrices } from "@/lib/history/pricing-sync"
import { useAppStore } from "@/store/app-store"
import { initModelPrices, syncModelPrices } from "./model-prices"

const prices = (fetchedAt: number): SyncedPrices => ({
  version: 1,
  source: "models.dev",
  fetchedAt,
  models: { "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } },
})

beforeEach(() => {
  jest.clearAllMocks()
  setSyncedPrices(null)
  useAppStore.setState({
    priceSync: { fetchedAt: null, models: 0, status: "idle", error: null },
    pricesVersion: 0,
  })
})

describe("syncModelPrices", () => {
  it("applies fresh prices and bumps the version every cost watches", async () => {
    ;(downloadPrices as jest.Mock).mockResolvedValue(prices(10))
    const pending = syncModelPrices("/h")
    expect(useAppStore.getState().priceSync.status).toBe("syncing")
    expect(await pending).toBe(true)
    expect(useAppStore.getState().priceSync).toEqual({
      fetchedAt: 10,
      models: 1,
      status: "idle",
      error: null,
    })
    expect(useAppStore.getState().pricesVersion).toBe(1)
    expect(priceForModel("claude-opus-5-5")?.input).toBe(4)
  })

  it("records a failure and keeps the prices already in use", async () => {
    useAppStore.getState().applyPrices(prices(5))
    ;(downloadPrices as jest.Mock).mockRejectedValue(new Error("offline"))
    expect(await syncModelPrices("/h")).toBe(false)
    expect(useAppStore.getState().priceSync).toMatchObject({
      fetchedAt: 5,
      status: "failed",
      error: "offline",
    })
    expect(priceForModel("claude-opus-5-5")).not.toBeNull()
  })

  it("joins a sync already running rather than starting a second", async () => {
    ;(downloadPrices as jest.Mock).mockResolvedValue(prices(1))
    const [a, b] = [syncModelPrices("/h"), syncModelPrices("/h")]
    await Promise.all([a, b])
    expect(downloadPrices).toHaveBeenCalledTimes(1)
  })
})

describe("initModelPrices", () => {
  const now = 10 * SYNC_INTERVAL_MS

  it("installs the cached copy, and leaves a fresh one alone", async () => {
    ;(loadCachedPrices as jest.Mock).mockResolvedValue(prices(now - 1000))
    await initModelPrices("/h", true, now)
    expect(useAppStore.getState().priceSync.fetchedAt).toBe(now - 1000)
    expect(downloadPrices).not.toHaveBeenCalled()
  })

  it("refreshes a copy over a day old, or a machine that never synced", async () => {
    ;(downloadPrices as jest.Mock).mockResolvedValue(prices(now))
    ;(loadCachedPrices as jest.Mock).mockResolvedValue(prices(now - SYNC_INTERVAL_MS))
    await initModelPrices("/h", true, now)
    ;(loadCachedPrices as jest.Mock).mockResolvedValue(null)
    await initModelPrices("/h", true, now)
    expect(downloadPrices).toHaveBeenCalledTimes(2)
  })

  it("never fetches when automatic syncing is off", async () => {
    ;(loadCachedPrices as jest.Mock).mockResolvedValue(null)
    await initModelPrices("/h", false, now)
    expect(downloadPrices).not.toHaveBeenCalled()
  })
})
