import { openUrl } from "@/lib/tauri/system"
import { cancelManagementStepUp, pollManagementStepUp, startManagementStepUp } from "./client"

/**
 * Why a browser approval ended without authorizing the write. `cancelled` is
 * the user's own doing (a Cancel button, a closed dialog) and is not an error
 * worth reporting; `expired` means nobody approved it in time.
 */
export class StepUpError extends Error {
  constructor(public readonly code: "cancelled" | "expired") {
    super(code === "cancelled" ? "STEP_UP_CANCELLED" : "STEP_UP_EXPIRED")
    this.name = "StepUpError"
  }
}

export function isStepUpCancelled(error: unknown): boolean {
  return error instanceof StepUpError && error.code === "cancelled"
}

export interface StepUpOptions {
  /** Aborting stops the wait and cancels the pending approval on the server. */
  signal?: AbortSignal
  /** Called once the approval page has been handed to the browser. */
  onWaiting?: () => void
}

export async function authorizeManagementPreview(
  instanceId: string,
  previewToken: string,
  { signal, onWaiting }: StepUpOptions = {}
): Promise<void> {
  if (signal?.aborted) throw new StepUpError("cancelled")
  const authorization = await startManagementStepUp(instanceId, previewToken)
  let completed = false
  try {
    if (signal?.aborted) throw new StepUpError("cancelled")
    await openUrl(authorization.authorizationUrl)
    onWaiting?.()
    while (Date.now() < authorization.expiresAt * 1000) {
      await wait(authorization.intervalSeconds * 1000, signal)
      const result = await pollManagementStepUp(instanceId, authorization.handle)
      if (signal?.aborted) throw new StepUpError("cancelled")
      if (result.status === "authorized") {
        completed = true
        return
      }
    }
    throw new StepUpError("expired")
  } finally {
    if (!completed) await cancelManagementStepUp(instanceId, authorization.handle).catch(() => {})
  }
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new StepUpError("cancelled"))
      return
    }
    const onAbort = () => {
      window.clearTimeout(timer)
      reject(new StepUpError("cancelled"))
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}
