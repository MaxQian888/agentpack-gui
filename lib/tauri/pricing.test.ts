let mockTauri = true
jest.mock("@/lib/tauri", () => ({ isTauri: () => mockTauri }))
jest.mock("@/lib/tauri/commands", () => ({
  fetchModelCatalog: jest.fn(),
  readTextFile: jest.fn(),
  writeTextFile: jest.fn(),
}))

import { fetchModelCatalog, readTextFile, writeTextFile } from "@/lib/tauri/commands"
import { downloadPrices, loadCachedPrices } from "./pricing"

const catalog = JSON.stringify({ anthropic: { models: { "claude-x": { cost: { input: 1, output: 2 } } } } }) // prettier-ignore

beforeEach(() => {
  mockTauri = true
  jest.clearAllMocks()
})

describe("loadCachedPrices", () => {
  it("reads the cached copy", async () => {
    ;(readTextFile as jest.Mock).mockResolvedValue(
      JSON.stringify({ version: 1, source: "models.dev", fetchedAt: 7, models: {} })
    )
    expect(await loadCachedPrices("/h")).toMatchObject({ fetchedAt: 7 })
    expect(readTextFile).toHaveBeenCalledWith("/h/.agentpack/model-prices.json")
  })

  it("is never synced, not an error, when the file can't be read — or in web mode", async () => {
    ;(readTextFile as jest.Mock).mockRejectedValue(new Error("EACCES"))
    expect(await loadCachedPrices("/h")).toBeNull()
    mockTauri = false
    expect(await loadCachedPrices("/h")).toBeNull()
  })
})

describe("downloadPrices", () => {
  it("fetches, keeps the vendor prices and caches them", async () => {
    ;(fetchModelCatalog as jest.Mock).mockResolvedValue(catalog)
    const prices = await downloadPrices("/h", 42)
    expect(prices.models["claude-x"]).toMatchObject({ input: 1, output: 2 })
    expect(writeTextFile).toHaveBeenCalledWith(
      "/h/.agentpack/model-prices.json",
      expect.stringContaining('"fetchedAt":42')
    )
  })

  it("still returns the prices when the cache write fails", async () => {
    ;(fetchModelCatalog as jest.Mock).mockResolvedValue(catalog)
    ;(writeTextFile as jest.Mock).mockRejectedValue(new Error("disk full"))
    await expect(downloadPrices("/h", 1)).resolves.toMatchObject({ fetchedAt: 1 })
  })

  it("rejects a fetch that failed or returned something else, writing nothing", async () => {
    ;(fetchModelCatalog as jest.Mock).mockRejectedValueOnce(new Error("HTTP 503"))
    await expect(downloadPrices("/h")).rejects.toThrow("HTTP 503")
    ;(fetchModelCatalog as jest.Mock).mockResolvedValueOnce("<html>")
    await expect(downloadPrices("/h")).rejects.toThrow()
    expect(writeTextFile).not.toHaveBeenCalled()
  })
})
