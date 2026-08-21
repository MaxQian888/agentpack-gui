"use client"

import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/tauri"
import { useT } from "@/lib/i18n/provider"
import { PROVIDER_APPS } from "@/lib/agentpack/ccswitch/types"
import type { LoginReport } from "@/lib/tauri/commands"
import { LoadingLine } from "./loading-line"

/**
 * Each CLI's own signed-in state — strictly read-only.
 *
 * agentpack never reads or writes the credential files themselves; this only
 * reports what `login_status` could tell from their metadata, which is why
 * macOS shows no plan or expiry.
 *
 * It used to render here *and* as a badge row in the aside — the same three
 * apps, twice on one screen, with the aside copy dropping the plan and expiry
 * that are the only reason to look. One home now, in the aside, as a list: at a
 * quarter of the width the old three-column grid truncated every value it had.
 */
export function LoginsCard({ login, loading }: { login: LoginReport | null; loading: boolean }) {
  const t = useT()
  const c = t.ccswitch

  return (
    <section aria-label={c.loginTitle} className="min-w-0 rounded-lg border p-4">
      <h3 className="font-medium">{c.loginTitle}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.loginHint}</p>
      {login ? (
        <dl className="mt-3 divide-y text-sm">
          {PROVIDER_APPS.map((app) => {
            const st = login[app]
            const detail = st.signedIn
              ? [
                  st.plan ?? undefined,
                  st.mode ?? undefined,
                  st.expiresAt
                    ? c.loginExpires(new Date(st.expiresAt).toLocaleDateString())
                    : undefined,
                ]
                  .filter(Boolean)
                  .join(" · ") || c.loginSignedIn
              : c.loginSignedOut
            return (
              <div key={app} className="flex min-w-0 items-start justify-between gap-3 py-2">
                <dt className="min-w-0 capitalize">{c.appLabels[app] ?? app}</dt>
                <dd className="flex min-w-0 shrink items-start gap-1.5 text-right text-xs text-muted-foreground">
                  <span className="min-w-0 [overflow-wrap:anywhere]">{detail}</span>
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1 size-1.5 shrink-0 rounded-[var(--hm-radius-dot)]",
                      st.signedIn ? "bg-[var(--hm-ok)]" : "bg-[var(--hm-neutral)]"
                    )}
                  />
                </dd>
              </div>
            )
          })}
        </dl>
      ) : loading ? (
        <div className="mt-3">
          <LoadingLine />
        </div>
      ) : (
        // A failed scan must not leave a spinner here forever.
        <p className="mt-3 text-sm text-muted-foreground">
          {isTauri() ? c.loginUnavailable : t.shell.notInTauri}
        </p>
      )}
    </section>
  )
}
