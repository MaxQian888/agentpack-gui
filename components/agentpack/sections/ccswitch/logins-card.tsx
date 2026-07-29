"use client"

import { KeyRound } from "lucide-react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/tauri"
import { useT } from "@/lib/i18n/provider"
import type { LoginReport } from "@/lib/tauri/commands"
import { LoadingLine } from "./loading-line"

/** The two CLIs that have an official login of their own. */
const LOGIN_APPS = ["claude", "codex"] as const

/**
 * Each CLI's own signed-in state — strictly read-only.
 *
 * agentpack never reads or writes the credential files themselves; this only
 * reports what `login_status` could tell from their metadata, which is why
 * macOS shows no plan or expiry.
 */
export function LoginsCard({ login, loading }: { login: LoginReport | null; loading: boolean }) {
  const t = useT()
  const c = t.ccswitch

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center gap-1.5 font-medium">
        <KeyRound className="size-4" />
        {c.loginTitle}
      </div>
      <p className="text-xs text-muted-foreground">{c.loginHint}</p>
      {login ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {LOGIN_APPS.map((app) => {
            const st = login[app]
            return (
              <div key={app} className="flex items-center gap-2 rounded-md border px-3 py-2">
                <span
                  aria-hidden
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    st.signedIn ? "bg-emerald-500" : "bg-muted-foreground/40"
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium capitalize">{app}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {st.signedIn
                      ? [
                          st.plan ?? undefined,
                          st.mode ?? undefined,
                          st.expiresAt
                            ? c.loginExpires(new Date(st.expiresAt).toLocaleDateString())
                            : undefined,
                        ]
                          .filter(Boolean)
                          .join(" · ") || c.loginSignedIn
                      : c.loginSignedOut}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : loading ? (
        <LoadingLine />
      ) : (
        // A failed scan must not leave a spinner here forever.
        <p className="text-sm text-muted-foreground">
          {isTauri() ? c.loginUnavailable : t.shell.notInTauri}
        </p>
      )}
    </Card>
  )
}
