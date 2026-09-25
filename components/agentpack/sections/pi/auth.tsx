"use client"

import { AlertTriangle, LogIn, LogOut, RefreshCw } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/provider"
import type { PiAuthProviderStatus } from "@/lib/pi/types"
import type { PiManagementController } from "../../pi-controller"
import { CapabilityEmpty, CapabilityList, CapabilityRow, RowChip } from "../capability-list"

/** Which of Pi's reported statuses mean ready, degraded, or broken. */
const OK = new Set(["ready", "valid", "configured"])
const WARN = new Set(["expired", "not_ready"])

function toneFor(status: string): "accent" | "warn" | "danger" | "neutral" {
  if (OK.has(status)) return "accent"
  if (WARN.has(status)) return "warn"
  if (status === "missing" || status === "invalid") return "danger"
  return "neutral"
}

/**
 * How Pi signs in, read only.
 *
 * The five-column grid this replaced had no scroll container and no empty
 * state, so on a narrow window the "Expires" column ran off the panel and a
 * machine that had never logged in showed a bare header row with nothing under
 * it. Rows carry the same five facts and wrap instead.
 */
export function PiAuthView({ controller }: { controller: PiManagementController }) {
  const m = useT().pi
  const { auth, authPending, authLoading, authError, loadAuth, openInteractive } = controller
  const providers: PiAuthProviderStatus[] = auth?.providers ?? []
  const reading = authPending || (authLoading && auth === null)

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-xs text-muted-foreground">{m.authHint}</p>
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => void loadAuth(true)}
          disabled={authLoading || authPending}
        >
          <RefreshCw className={cn("size-4", authLoading && "animate-spin")} />
          {m.refreshAuth}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => void openInteractive("/login")}
        >
          <LogIn className="size-4" />
          {m.login}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => void openInteractive("/logout")}
        >
          <LogOut className="size-4" />
          {m.logout}
        </Button>
      </div>

      {/* Three different answers used to share "Pi reports no providers yet":
          still reading, the read failed, and an honest empty list. */}
      {reading ? (
        <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          {m.authReading}
        </div>
      ) : authError !== null ? (
        <div className="flex min-w-0 flex-col gap-3">
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertDescription className="[overflow-wrap:anywhere]">
              {m.authReadFailed(authError)}
            </AlertDescription>
          </Alert>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 self-start"
            disabled={authLoading}
            onClick={() => void loadAuth(false)}
          >
            <RefreshCw className="size-4" />
            {m.retry}
          </Button>
        </div>
      ) : providers.length === 0 ? (
        <CapabilityEmpty message={m.noProviders} />
      ) : (
        <CapabilityList label={m.providersLabel}>
          {providers.map((provider) => (
            <CapabilityRow
              key={provider.provider}
              title={provider.provider}
              tags={
                <>
                  <span>
                    {provider.authType ? (m.authTypes[provider.authType] ?? m.unknown) : "—"}
                  </span>
                  <span>{m.authSources[provider.source] ?? m.unknown}</span>
                  {provider.expiresAt ? (
                    <span className="font-mono">
                      {m.expiresAt(new Date(provider.expiresAt).toLocaleString())}
                    </span>
                  ) : null}
                </>
              }
              description={provider.reason}
              status={
                <RowChip tone={toneFor(provider.status)}>
                  {m.authStatuses[provider.status] ?? m.unknown}
                </RowChip>
              }
            />
          ))}
        </CapabilityList>
      )}
    </div>
  )
}
