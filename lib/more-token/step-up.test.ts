jest.mock("@/lib/tauri/system", () => ({ openUrl: jest.fn(async () => undefined) }))
jest.mock("./client", () => ({
  startManagementStepUp: jest.fn(),
  pollManagementStepUp: jest.fn(),
  cancelManagementStepUp: jest.fn(async () => undefined),
}))

import { openUrl } from "@/lib/tauri/system"
import { cancelManagementStepUp, pollManagementStepUp, startManagementStepUp } from "./client"
import { authorizeManagementPreview, isStepUpCancelled, StepUpError } from "./step-up"

const start = startManagementStepUp as jest.Mock
const poll = pollManagementStepUp as jest.Mock
const cancel = cancelManagementStepUp as jest.Mock

const NOW = 1_700_000_000_000

function authorization(overrides: Partial<{ expiresAt: number; intervalSeconds: number }> = {}) {
  return {
    handle: "h-1",
    authorizationUrl: "https://mt.example/step-up/h-1",
    expiresAt: NOW / 1000 + 30,
    intervalSeconds: 2,
    ...overrides,
  }
}

/** Let the pending awaits run without moving the clock. */
const flush = () => jest.advanceTimersByTimeAsync(0)

beforeEach(() => {
  jest.useFakeTimers({ now: NOW })
  cancel.mockResolvedValue(undefined)
})
afterEach(() => jest.useRealTimers())

describe("StepUpError", () => {
  it("names the reason in its message and only treats a cancel as cancelled", () => {
    const cancelled = new StepUpError("cancelled")
    const expired = new StepUpError("expired")
    expect(cancelled.message).toBe("STEP_UP_CANCELLED")
    expect(expired.message).toBe("STEP_UP_EXPIRED")
    expect(cancelled.name).toBe("StepUpError")
    expect(isStepUpCancelled(cancelled)).toBe(true)
    expect(isStepUpCancelled(expired)).toBe(false)
    expect(isStepUpCancelled(new Error("STEP_UP_CANCELLED"))).toBe(false)
    expect(isStepUpCancelled(undefined)).toBe(false)
  })
})

describe("authorizeManagementPreview", () => {
  it("opens the approval page, polls on the server's interval and resolves once authorized", async () => {
    start.mockResolvedValue(authorization())
    poll
      .mockResolvedValueOnce({ status: "authorization_pending" })
      .mockResolvedValueOnce({ status: "authorized" })
    const onWaiting = jest.fn()

    const done = authorizeManagementPreview("i-1", "preview-token", { onWaiting })
    await flush()
    expect(start).toHaveBeenCalledWith("i-1", "preview-token")
    expect(openUrl).toHaveBeenCalledWith("https://mt.example/step-up/h-1")
    expect(onWaiting).toHaveBeenCalledTimes(1)
    expect(poll).not.toHaveBeenCalled()

    await jest.advanceTimersByTimeAsync(1_999)
    expect(poll).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(1)
    expect(poll).toHaveBeenCalledTimes(1)
    expect(poll).toHaveBeenCalledWith("i-1", "h-1")
    await jest.advanceTimersByTimeAsync(2_000)

    await expect(done).resolves.toBeUndefined()
    expect(poll).toHaveBeenCalledTimes(2)
    // An approved step-up is spent by the write it authorized — never cancelled.
    expect(cancel).not.toHaveBeenCalled()
  })

  it("expires when nobody approves in time, and withdraws the pending approval", async () => {
    start.mockResolvedValue(authorization({ expiresAt: NOW / 1000 + 5 }))
    poll.mockResolvedValue({ status: "authorization_pending" })

    const done = authorizeManagementPreview("i-1", "preview-token")
    const outcome = expect(done).rejects.toEqual(new StepUpError("expired"))
    await jest.advanceTimersByTimeAsync(6_000)
    await outcome
    expect(poll).toHaveBeenCalledTimes(3)
    expect(cancel).toHaveBeenCalledWith("i-1", "h-1")
  })

  it("never starts a step-up for an already-aborted signal", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      authorizeManagementPreview("i-1", "t", { signal: controller.signal })
    ).rejects.toEqual(new StepUpError("cancelled"))
    expect(start).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
  })

  it("cancels on the server when aborted while the step-up was being started", async () => {
    const controller = new AbortController()
    start.mockImplementation(async () => {
      controller.abort()
      return authorization()
    })
    await expect(
      authorizeManagementPreview("i-1", "t", { signal: controller.signal })
    ).rejects.toEqual(new StepUpError("cancelled"))
    expect(openUrl).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledWith("i-1", "h-1")
  })

  it("stops waiting the moment the signal aborts between polls", async () => {
    const controller = new AbortController()
    start.mockResolvedValue(authorization())
    poll.mockResolvedValue({ status: "authorization_pending" })

    const done = authorizeManagementPreview("i-1", "t", { signal: controller.signal })
    const outcome = expect(done).rejects.toEqual(new StepUpError("cancelled"))
    await jest.advanceTimersByTimeAsync(2_500)
    expect(poll).toHaveBeenCalledTimes(1)
    controller.abort()
    await outcome
    expect(poll).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith("i-1", "h-1")
    // The aborted wait cleared its timer, so nothing polls afterwards.
    await jest.advanceTimersByTimeAsync(10_000)
    expect(poll).toHaveBeenCalledTimes(1)
  })

  it("discards an authorization that lands after the caller cancelled", async () => {
    const controller = new AbortController()
    start.mockResolvedValue(authorization())
    poll.mockImplementation(async () => {
      controller.abort()
      return { status: "authorized" }
    })
    const done = authorizeManagementPreview("i-1", "t", { signal: controller.signal })
    const outcome = expect(done).rejects.toEqual(new StepUpError("cancelled"))
    await jest.advanceTimersByTimeAsync(2_000)
    await outcome
    expect(cancel).toHaveBeenCalledWith("i-1", "h-1")
  })

  it("rejects without waiting when aborted after the page opened but before the first wait", async () => {
    const controller = new AbortController()
    start.mockResolvedValue(authorization())
    const onWaiting = jest.fn(() => controller.abort())
    await expect(
      authorizeManagementPreview("i-1", "t", { signal: controller.signal, onWaiting })
    ).rejects.toEqual(new StepUpError("cancelled"))
    expect(poll).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledWith("i-1", "h-1")
  })

  it("surfaces the original failure even when the server-side cancel fails too", async () => {
    start.mockResolvedValue(authorization())
    poll.mockRejectedValue(new Error("network down"))
    cancel.mockRejectedValue(new Error("also down"))
    const done = authorizeManagementPreview("i-1", "t")
    const outcome = expect(done).rejects.toThrow("network down")
    await jest.advanceTimersByTimeAsync(2_000)
    await outcome
    expect(cancel).toHaveBeenCalledWith("i-1", "h-1")
  })

  it("propagates a failure to start without trying to cancel a handle it never got", async () => {
    start.mockRejectedValue(new Error("preview expired"))
    await expect(authorizeManagementPreview("i-1", "t")).rejects.toThrow("preview expired")
    expect(cancel).not.toHaveBeenCalled()
  })
})
