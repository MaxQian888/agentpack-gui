import { openUrl } from "@/lib/tauri/system"
import { cancelManagementStepUp, pollManagementStepUp, startManagementStepUp } from "./client"

export async function authorizeManagementPreview(
  instanceId: string,
  previewToken: string
): Promise<void> {
  const authorization = await startManagementStepUp(instanceId, previewToken)
  let completed = false
  try {
    await openUrl(authorization.authorizationUrl)
    while (Date.now() < authorization.expiresAt * 1000) {
      await new Promise((resolve) =>
        window.setTimeout(resolve, authorization.intervalSeconds * 1000)
      )
      const result = await pollManagementStepUp(instanceId, authorization.handle)
      if (result.status === "authorized") {
        completed = true
        return
      }
    }
    throw new Error("Browser approval expired")
  } finally {
    if (!completed) await cancelManagementStepUp(instanceId, authorization.handle).catch(() => {})
  }
}
