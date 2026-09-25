jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))

const mockList = jest.fn()
const mockSeries = jest.fn()
jest.mock("@/lib/tauri/commands", () => ({
  historyListSessions: (...a: unknown[]) => mockList(...a),
  historyUsageSeries: (...a: unknown[]) => mockSeries(...a),
}))

import { act, renderHook, waitFor } from "@testing-library/react"
import {
  WHOLE_SCAN,
  type ListResult,
  type SessionSummary,
  type UsageSeriesResult,
} from "@/lib/history/types"
import { useHistoryScans } from "./use-history-scans"

/** A promise the test settles by hand, to order two scans deliberately. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const list = (title: string): ListResult => ({
  sessions: [{ title } as SessionSummary],
  errors: [],
})
const SERIES: UsageSeriesResult = { sessions: [], errors: [] }

beforeEach(() => {
  mockList.mockReset()
  mockSeries.mockReset()
})

describe("useHistoryScans — a failed scan", () => {
  it("records a rejected startup scan as an error, not as an empty machine", async () => {
    mockList.mockRejectedValue(new Error("cache is corrupt"))
    const { result } = renderHook(() => useHistoryScans())
    await waitFor(() => expect(result.current.result).not.toBeNull())
    expect(result.current.result).toEqual({
      sessions: [],
      errors: [{ source: WHOLE_SCAN, message: "cache is corrupt" }],
    })
  })

  it("records a rejected Rescan the same way, with the system's message", async () => {
    mockList.mockResolvedValueOnce(list("first")).mockRejectedValueOnce("EACCES")
    const { result } = renderHook(() => useHistoryScans())
    await waitFor(() => expect(result.current.result).toEqual(list("first")))
    await act(() => result.current.rescan())
    expect(result.current.result?.errors).toEqual([{ source: WHOLE_SCAN, message: "EACCES" }])
    expect(result.current.loading).toBe(false)
  })

  it("records a rejected series read, so nothing waits on it forever", async () => {
    mockList.mockResolvedValue(list("first"))
    mockSeries.mockRejectedValue(new Error("database is locked"))
    const { result } = renderHook(() => useHistoryScans())
    await act(() => result.current.loadSeries())
    expect(result.current.series).toEqual({
      sessions: [],
      errors: [{ source: WHOLE_SCAN, message: "database is locked" }],
    })
    expect(result.current.seriesLoading).toBe(false)
  })
})

describe("useHistoryScans — the series", () => {
  it("starts one fetch however many surfaces ask while it is in flight", async () => {
    mockList.mockResolvedValue(list("first"))
    const pending = deferred<UsageSeriesResult>()
    mockSeries.mockReturnValue(pending.promise)
    const { result } = renderHook(() => useHistoryScans())
    act(() => {
      void result.current.loadSeries()
      void result.current.loadSeries()
    })
    expect(mockSeries).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve(SERIES))
    // Loaded: still no second fetch.
    await act(() => result.current.loadSeries())
    expect(mockSeries).toHaveBeenCalledTimes(1)
    expect(result.current.series).toBe(SERIES)
  })

  // The dashboard asks again once a Rescan has dropped the series; the old
  // guard would have treated that as "already asked" and never fetched.
  it("fetches again after a Rescan drops it", async () => {
    mockList.mockResolvedValue(list("first"))
    mockSeries.mockResolvedValue(SERIES)
    const { result } = renderHook(() => useHistoryScans())
    await act(() => result.current.loadSeries())
    await act(() => result.current.rescan())
    expect(result.current.series).toBeNull()
    await act(() => result.current.loadSeries())
    expect(mockSeries).toHaveBeenCalledTimes(2)
    expect(result.current.series).toBe(SERIES)
  })
})

describe("useHistoryScans — overlapping scans", () => {
  it("drops a slow startup scan that lands after a Rescan", async () => {
    const startup = deferred<ListResult>()
    mockList.mockReturnValueOnce(startup.promise).mockResolvedValueOnce(list("rescan"))
    const { result } = renderHook(() => useHistoryScans())
    await act(() => result.current.rescan())
    expect(result.current.result).toEqual(list("rescan"))
    await act(async () => startup.resolve(list("stale")))
    expect(result.current.result).toEqual(list("rescan"))
  })

  it("drops a series read that began before the Rescan", async () => {
    mockList.mockResolvedValue(list("first"))
    const old = deferred<UsageSeriesResult>()
    mockSeries.mockReturnValueOnce(old.promise)
    const { result } = renderHook(() => useHistoryScans())
    act(() => {
      void result.current.loadSeries()
    })
    expect(result.current.seriesLoading).toBe(true)
    await act(() => result.current.rescan())
    // The Rescan released the stale fetch's hold, so the dashboard can ask anew.
    expect(result.current.seriesLoading).toBe(false)
    await act(async () => old.resolve({ sessions: [], errors: [{ source: "x", message: "old" }] }))
    expect(result.current.series).toBeNull()
  })
})
