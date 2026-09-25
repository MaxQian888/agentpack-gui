"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useT } from "@/lib/i18n/provider"
import { authorizeManagementPreview, StepUpError } from "@/lib/more-token/step-up"

/**
 * Browser approval for one management write. Once the approval page is open
 * nothing in the app moves until someone approves it there, so the caller needs
 * to know it is waiting — to relabel the button that started it — and needs a
 * way to stop waiting. Unmounting stops the wait too, and a stopped wait
 * cancels the pending approval on the server (see `authorizeManagementPreview`).
 */
export function useStepUp(instanceId: string) {
  const m = useT().management
  const [waiting, setWaiting] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])

  const authorize = useCallback(
    async (previewToken: string) => {
      controller.current?.abort()
      const abort = new AbortController()
      controller.current = abort
      try {
        await authorizeManagementPreview(instanceId, previewToken, {
          signal: abort.signal,
          onWaiting: () => setWaiting(true),
        })
      } catch (error) {
        if (error instanceof StepUpError && error.code === "expired") {
          throw new Error(m.stepUpExpired)
        }
        throw error
      } finally {
        if (controller.current === abort) {
          controller.current = null
          setWaiting(false)
        }
      }
    },
    [instanceId, m.stepUpExpired]
  )
  const cancel = useCallback(() => controller.current?.abort(), [])
  return { authorize, waiting, cancel }
}
