import { toast } from "sonner"
import { downloadCsv } from "@/lib/more-token/client"
import { errorText } from "./errors"

/**
 * Export with feedback. A file written through the save dialog is somewhere the
 * user can't see from here, so it gets a toast naming the path; a cancelled
 * dialog gets nothing; a failed write says why instead of doing nothing.
 */
export async function saveCsv(
  filename: string,
  rows: Array<Array<string | number>>,
  messages: { saved: (path: string) => string; failed: (reason: string) => string }
): Promise<void> {
  try {
    const result = await downloadCsv(filename, rows)
    if (result?.kind === "saved") toast.success(messages.saved(result.path))
  } catch (error) {
    toast.error(messages.failed(errorText(error)))
  }
}
