import { ManagementApiError } from "@/lib/more-token/client"

/** The failure as the server or the Rust transport reported it — code first. */
export function errorText(error: unknown): string {
  if (error instanceof ManagementApiError) return `${error.code}: ${error.message}`
  return error instanceof Error ? error.message : String(error)
}
