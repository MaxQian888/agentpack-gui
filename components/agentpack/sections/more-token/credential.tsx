"use client"

import { useCallback } from "react"
import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import { useT } from "@/lib/i18n/provider"
import { forgetCredential } from "@/lib/more-token/client"
import { useConfirm } from "./confirm-dialog"
import { errorText } from "./errors"

/**
 * Drop everything cached for one instance except the credential reading, then
 * re-read that. The credential query never goes stale on its own, so without
 * this a credential Rust just deleted still reads as connected; and a cached
 * profile or balance would be shown to whoever signs in next until its own
 * refetch landed (design.md § 10). Removed rather than invalidated so nothing
 * is re-requested with a credential that no longer exists.
 */
export async function resetInstanceQueries(queryClient: QueryClient, instanceId: string) {
  queryClient.removeQueries({
    queryKey: ["more-token", instanceId],
    predicate: (query) => query.queryKey[2] !== "credential",
  })
  await queryClient.invalidateQueries({ queryKey: ["more-token", instanceId, "credential"] })
}

/**
 * Forget a desktop credential the way both workspaces must: ask the server to
 * revoke it first, and only if that fails offer to delete the local copy —
 * saying plainly that the server copy may stay active. Resolves true once the
 * local credential is gone (and the instance's cache with it), false when the
 * user kept it. Render `dialog` once in the caller.
 */
export function useForgetCredential() {
  const m = useT().management
  const queryClient = useQueryClient()
  const { confirm, dialog } = useConfirm()
  const forget = useCallback(
    async (instanceId: string) => {
      try {
        await forgetCredential(instanceId)
      } catch (error) {
        const localOnly = await confirm({
          title: m.localOnlyCredentialTitle,
          description: (
            <>
              <span className="block font-mono text-xs [overflow-wrap:anywhere]">
                {errorText(error)}
              </span>
              <span className="mt-2 block">{m.localOnlyCredentialWarning}</span>
            </>
          ),
          confirmLabel: m.deleteLocalCopy,
          cancelLabel: m.cancel,
          destructive: true,
        })
        if (!localOnly) return false
        await forgetCredential(instanceId, true)
      }
      await resetInstanceQueries(queryClient, instanceId)
      return true
    },
    [confirm, m, queryClient]
  )
  return { forget, dialog }
}
