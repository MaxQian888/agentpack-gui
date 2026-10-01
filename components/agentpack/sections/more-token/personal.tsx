/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 */
/* Hallmark · genre: modern-minimal · macrostructure: Workbench · design-system: design.md · designed-as-app */
"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  Download,
  ExternalLink,
  KeyRound,
  MonitorCheck,
  Orbit,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Unplug,
} from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useT } from "@/lib/i18n/provider"
import { isTauri } from "@/lib/tauri"
import { hasInjectedMoreTokenPort } from "@/lib/more-token/port"
import { openUrl } from "@/lib/tauri/system"
import { cn } from "@/lib/utils"
import {
  cancelPersonalOAuth,
  credentialState,
  forgetCredential,
  listInstances,
  loginPersonalInstance,
  managementRequest,
  operationId,
  pairInstance,
  pollPersonalOAuth,
  quotaCurrencyLabel,
  quotaCurrencyParts,
  sameOriginServerUrl,
  startPersonalOAuth,
} from "@/lib/more-token/client"
import type {
  MoreTokenInstance,
  Page,
  PersonalAccount,
  PersonalCloseBody,
  PersonalBalance,
  PersonalCapabilities,
  PersonalLedgerEntry,
  PersonalModel,
  PersonalModelCatalog,
  PersonalOverview,
  PersonalPasswordBody,
  PersonalSession,
  PersonalUsage,
  PersonalView,
} from "@/lib/more-token/types"
import { DesktopOnlyNote } from "../../desktop-only-note"
import { CapabilityMetric, CapabilityTile, CapabilityWorkbench } from "../capability-workbench"
import { resetInstanceQueries, useForgetCredential } from "./credential"
import { saveCsv } from "./csv"
import { errorText } from "./errors"
import { InstanceDialog } from "./instance-dialog"

const PERSONAL_CLIENT_ID = "agentpack-personal-desktop"

function request<T>(instanceId: string, operation: Parameters<typeof managementRequest>[1]) {
  return managementRequest<T>(instanceId, operation).then((response) => response.data)
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatTime(value: number): string {
  if (!value) return "—"
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value * 1000)
  )
}

export function PersonalMoreTokenSection({
  view,
  onOpenSecurity,
}: {
  view: PersonalView
  /**
   * Goes to My account → Security. Navigation belongs to the shell, so the
   * required-password notice offers the way there only when it is given one.
   */
  onOpenSecurity?: () => void
}) {
  const m = useT()
  const personal = m.personal
  const management = m.management
  const queryClient = useQueryClient()
  const tauri = isTauri() || hasInjectedMoreTokenPort()
  const [selectedId, setSelectedId] = useState("")
  // Same dialog as the management workspace: a personal connection is edited
  // and removed exactly like a management one. `seq` remounts it per opening.
  const [instanceDialog, setInstanceDialog] = useState<{
    open: boolean
    mode: "add" | "edit"
    seq: number
  }>({ open: false, mode: "add", seq: 0 })
  const openInstanceDialog = (mode: "add" | "edit") =>
    setInstanceDialog((current) => ({ open: true, mode, seq: current.seq + 1 }))
  const { forget, dialog: forgetDialog } = useForgetCredential()
  const instancesQuery = useQuery({
    queryKey: ["more-token", "instances"],
    queryFn: listInstances,
    enabled: tauri,
    staleTime: Infinity,
  })
  const instances = (instancesQuery.data ?? []).filter(
    (instance) => instance.package === "personal"
  )
  // A selection the list no longer holds (removed, or not refetched yet) falls
  // back to the first instance rather than to a null one.
  const activeId = instances.some((item) => item.id === selectedId)
    ? selectedId
    : instances[0]?.id || ""
  const instance = instances.find((item) => item.id === activeId) ?? null
  const credential = useQuery({
    queryKey: ["more-token", activeId, "credential"],
    queryFn: () => credentialState(activeId),
    enabled: tauri && activeId !== "",
    staleTime: Infinity,
  })
  const capabilities = useQuery({
    queryKey: ["more-token", activeId, "personal-capabilities"],
    queryFn: () => request<PersonalCapabilities>(activeId, { kind: "personalCapabilities" }),
    enabled: credential.data?.connected === true,
  })

  if (!tauri) {
    return (
      <CapabilityWorkbench
        title={personal.title}
        subtitle={personal.subtitle}
        summaryLabel={personal.statusSummary}
        actionsLabel={personal.supportingActions}
        primary={<DesktopOnlyNote>{personal.desktopOnly}</DesktopOnlyNote>}
      />
    )
  }

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["more-token", activeId] })
  const actions =
    // With no instance yet, the empty state's own "Add instance" is the one way
    // in; this header copy (and the aside's) would make it three buttons for
    // one action on an otherwise empty page.
    instances.length === 0 ? null : (
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => openInstanceDialog("add")}>
          <Plus className="size-4" />
          <span className="hidden sm:inline">{management.addInstance}</span>
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={management.retry}
          disabled={!activeId}
          onClick={refresh}
        >
          <RefreshCw className="size-4" />
        </Button>
      </div>
    )

  const title = personal.tabs[view.replace("my-", "") as keyof typeof personal.tabs]
  const connected = credential.data?.connected === true
  const connectionLabel = credential.isLoading
    ? management.loading
    : credential.isError
      ? management.unavailable
      : connected
        ? management.healthy
        : management.unavailable
  const primary = instancesQuery.isError ? (
    <PersonalError error={instancesQuery.error} retry={() => void instancesQuery.refetch()} />
  ) : instancesQuery.isLoading ? (
    <PersonalLoading />
  ) : instances.length === 0 ? (
    <FlatEmpty text={management.noInstances} action={() => openInstanceDialog("add")} />
  ) : credential.isError ? (
    <PersonalError error={credential.error} retry={() => void credential.refetch()} />
  ) : credential.isLoading ? (
    <PersonalLoading />
  ) : credential.data?.connected !== true ? (
    <PersonalPairPanel instance={instance!} onPaired={() => void credential.refetch()} />
  ) : capabilities.isError ? (
    <PersonalError error={capabilities.error} retry={() => void capabilities.refetch()} />
  ) : capabilities.data ? (
    <div className="min-w-0 space-y-4">
      {capabilities.data.must_change_password ? (
        <Alert variant="destructive">
          <KeyRound className="size-4" />
          <AlertTitle>{personal.mustChangePassword}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{personal.mustChangePasswordHint}</span>
            {onOpenSecurity && view !== "my-security" ? (
              <Button variant="outline" size="sm" onClick={onOpenSecurity}>
                {personal.openSecurity}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {view === "my-account" ? (
        <PersonalAccountView instance={instance!} capabilities={capabilities.data} />
      ) : view === "my-balance" ? (
        <PersonalBalanceView instance={instance!} />
      ) : view === "my-usage" ? (
        <PersonalUsageView instance={instance!} />
      ) : view === "my-models" ? (
        <PersonalModelsView instance={instance!} />
      ) : (
        <PersonalSecurityView instance={instance!} capabilities={capabilities.data} />
      )}
    </div>
  ) : (
    <PersonalLoading />
  )

  return (
    <CapabilityWorkbench
      title={title}
      subtitle={personal.subtitle}
      actions={actions}
      summaryLabel={personal.statusSummary}
      actionsLabel={personal.supportingActions}
      metrics={
        <>
          <CapabilityMetric
            label={management.instances}
            value={
              instancesQuery.isLoading || instancesQuery.isError
                ? "—"
                : formatNumber(instances.length)
            }
            detail={
              instancesQuery.isLoading
                ? management.loading
                : instancesQuery.isError
                  ? errorText(instancesQuery.error)
                  : undefined
            }
          />
          <CapabilityMetric
            label={management.health}
            value={
              // No instance is nothing to measure, not an unavailable one.
              !instance || instancesQuery.isLoading || credential.isLoading || credential.isError
                ? "—"
                : connected
                  ? management.healthy
                  : management.unavailable
            }
            detail={
              credential.isLoading
                ? management.loading
                : credential.isError
                  ? errorText(credential.error)
                  : undefined
            }
          />
          <CapabilityMetric
            label={personal.apiVersion}
            value={capabilities.data?.personal_api_version ?? "—"}
          />
          <CapabilityMetric label={management.role} value={capabilities.data?.role ?? "—"} />
        </>
      }
      primary={primary}
      aside={
        <>
          <CapabilityTile
            title={management.connection}
            description={management.connectionHint}
            active={connected}
            action={
              instance ? (
                <Badge variant={connected ? "outline" : "secondary"}>{connectionLabel}</Badge>
              ) : undefined
            }
          >
            {instance ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="personal-more-token-instance">{management.instance}</Label>
                  <select
                    id="personal-more-token-instance"
                    value={activeId}
                    onChange={(event) => setSelectedId(event.target.value)}
                    className="h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {instances.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {instance.baseUrl}
                </p>
                <p className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {connected
                    ? credential.data?.persistent
                      ? management.persistentCredential
                      : management.memoryCredential
                    : personal.signInTitle}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => openInstanceDialog("edit")}>
                    {management.editInstance}
                  </Button>
                  {connected ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        try {
                          await forget(activeId)
                        } catch (error) {
                          toast.error(errorText(error))
                        }
                      }}
                    >
                      <Unplug className="size-4" />
                      {management.disconnect}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              // Nothing is connected, and the empty state beside this already
              // says how to start — the tile doesn't repeat it.
              <p className="font-mono text-sm text-muted-foreground">—</p>
            )}
          </CapabilityTile>
          <CapabilityTile title={personal.packageLabel} description={personal.isolationNote}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="size-4 text-[var(--hm-ok)]" />
              <span>{personal.tabs.account}</span>
            </div>
          </CapabilityTile>
        </>
      }
      detail={
        <>
          <InstanceDialog
            key={instanceDialog.seq}
            open={instanceDialog.open}
            instance={instanceDialog.mode === "edit" ? instance : null}
            pkg="personal"
            onOpenChange={(open) => setInstanceDialog((current) => ({ ...current, open }))}
            onSaved={(saved) => setSelectedId(saved.id)}
            onRemoved={() => setSelectedId("")}
          />
          {forgetDialog}
        </>
      }
    />
  )
}

function PersonalLoading() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-16" />
      <Skeleton className="h-64" />
    </div>
  )
}

function FlatEmpty({ text, action }: { text: string; action: () => void }) {
  const m = useT().management
  return (
    <div className="flex min-h-52 flex-col items-center justify-center gap-3 border-y text-center text-sm text-muted-foreground">
      <p>{text}</p>
      <Button onClick={action}>{m.addInstance}</Button>
    </div>
  )
}

function PersonalError({ error, retry }: { error: unknown; retry: () => void }) {
  const m = useT().management
  return (
    <Alert variant="destructive">
      <AlertTriangle className="size-4" />
      <AlertTitle>{m.unavailable}</AlertTitle>
      <AlertDescription className="flex items-center justify-between gap-3">
        <span>{errorText(error)}</span>
        <Button variant="outline" size="sm" onClick={retry}>
          {m.retry}
        </Button>
      </AlertDescription>
    </Alert>
  )
}

function PersonalPairPanel({
  instance,
  onPaired,
}: {
  instance: MoreTokenInstance
  onPaired: () => void
}) {
  const t = useT()
  const m = t.management
  const personal = t.personal
  const codeRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<"browser" | "password" | "pairing">("browser")
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false)
  const [oauth, setOauth] = useState<Awaited<ReturnType<typeof startPersonalOAuth>> | null>(null)
  const mutation = useMutation({
    mutationFn: () => pairInstance(instance.id, codeRef.current?.value ?? "", PERSONAL_CLIENT_ID),
    onSuccess: (result) => {
      toast.success(result.credentialPersistent ? m.persistentCredential : m.memoryCredential)
      if (codeRef.current) codeRef.current.value = ""
      onPaired()
    },
    onError: (error) => toast.error(errorText(error)),
  })
  const login = useMutation({
    mutationFn: (form: HTMLFormElement) => {
      const values = new FormData(form)
      return loginPersonalInstance(
        instance.id,
        String(values.get("username") ?? ""),
        String(values.get("password") ?? ""),
        String(values.get("twoFactorCode") ?? "") || null,
        PERSONAL_CLIENT_ID,
        "AgentPack Desktop"
      )
    },
    onSuccess: (result) => {
      toast.success(result.credentialPersistent ? m.persistentCredential : m.memoryCredential)
      onPaired()
    },
    onError: (error) => {
      const message = errorText(error)
      if (message.includes("TWO_FACTOR_REQUIRED")) setNeedsTwoFactor(true)
      toast.error(message)
    },
  })
  const browser = useMutation({
    mutationFn: () => startPersonalOAuth(instance.id, PERSONAL_CLIENT_ID, "AgentPack Desktop"),
    onSuccess: async (result) => {
      setOauth(result)
      await openUrl(result.authorizationUrl)
    },
    onError: (error) => toast.error(errorText(error)),
  })
  // The poll has to outlive renders. The parent passes an inline `onPaired`, so
  // with it in the effect's deps every unrelated parent re-render (an instance
  // or credential refetch) tore the poll down — and the cleanup cancelled the
  // very authorization the user was approving in the browser. The callback and
  // copy ride in a ref instead; the poll restarts only for a new handle.
  const latest = useRef({
    onPaired,
    persistent: m.persistentCredential,
    memory: m.memoryCredential,
  })
  useEffect(() => {
    latest.current = {
      onPaired,
      persistent: m.persistentCredential,
      memory: m.memoryCredential,
    }
  })
  const instanceId = instance.id
  useEffect(() => {
    if (!oauth) return
    let cancelled = false
    // An authorized or failed handle has nothing left to cancel on the server.
    let finished = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const result = await pollPersonalOAuth(instanceId, oauth.handle)
        if (cancelled) return
        if (result.status === "authorized" && result.credential) {
          finished = true
          toast.success(
            result.credential.credentialPersistent
              ? latest.current.persistent
              : latest.current.memory
          )
          latest.current.onPaired()
          return
        }
        timer = setTimeout(poll, (result.status === "slow_down" ? 6 : oauth.intervalSeconds) * 1000)
      } catch (error) {
        if (!cancelled) {
          finished = true
          setOauth(null)
          toast.error(errorText(error))
        }
      }
    }
    timer = setTimeout(poll, oauth.intervalSeconds * 1000)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      if (!finished) void cancelPersonalOAuth(instanceId, oauth.handle).catch(() => undefined)
    }
  }, [instanceId, oauth])
  // Leaving the browser tab of the panel stops waiting on the browser.
  const selectMode = (next: typeof mode) => {
    if (next !== "browser") setOauth(null)
    setMode(next)
  }
  return (
    <div className="mx-auto max-w-xl space-y-4 border-y py-8">
      <div>
        <h3 className="flex items-center gap-2 font-medium">
          <KeyRound className="size-4" />
          {mode === "browser"
            ? personal.browserSignIn
            : mode === "password"
              ? personal.signInTitle
              : m.pairTitle}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "browser"
            ? personal.browserSignInHint
            : mode === "password"
              ? personal.signInHint
              : m.pairHint}
        </p>
      </div>
      <div className="grid grid-cols-3 rounded-md border p-1">
        <Button
          type="button"
          variant={mode === "browser" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => selectMode("browser")}
        >
          {personal.browserOption}
        </Button>
        <Button
          type="button"
          variant={mode === "password" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => selectMode("password")}
        >
          {personal.passwordOption}
        </Button>
        <Button
          type="button"
          variant={mode === "pairing" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => selectMode("pairing")}
        >
          {personal.pairingOption}
        </Button>
      </div>
      {mode === "browser" ? (
        <div className="space-y-3 rounded-lg bg-muted/45 p-4">
          <div className="flex items-start gap-3">
            <MonitorCheck className="mt-0.5 size-5 shrink-0" />
            <p className="text-sm text-muted-foreground">
              {oauth ? personal.waitingForBrowser : personal.otherLoginHint}
            </p>
          </div>
          <Button
            className="min-h-11 w-full"
            disabled={browser.isPending || Boolean(oauth)}
            onClick={() => browser.mutate()}
          >
            <ExternalLink className="size-4" />
            {oauth ? personal.waitingForBrowser : personal.browserSignIn}
          </Button>
          {oauth ? (
            <div className="flex flex-wrap gap-2">
              {/* Clearing the handle cancels it (the poll's cleanup); a restart
                  then asks for a fresh one and opens the browser again. */}
              <Button
                variant="outline"
                size="sm"
                disabled={browser.isPending}
                onClick={() => {
                  setOauth(null)
                  browser.mutate()
                }}
              >
                {personal.restartBrowserSignIn}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setOauth(null)}>
                {m.cancel}
              </Button>
            </div>
          ) : null}
        </div>
      ) : mode === "password" ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            login.mutate(event.currentTarget)
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="personal-username">{personal.usernameOrEmail}</Label>
            <Input id="personal-username" name="username" autoComplete="username" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="personal-password">{m.password}</Label>
            <Input
              id="personal-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          {needsTwoFactor ? (
            <div className="space-y-2">
              <Label htmlFor="personal-two-factor">{personal.twoFactorCode}</Label>
              <Input
                id="personal-two-factor"
                name="twoFactorCode"
                autoComplete="one-time-code"
                required
              />
              <p className="text-xs text-muted-foreground">{personal.twoFactorHint}</p>
            </div>
          ) : null}
          <Button type="submit" className="min-h-11 w-full" disabled={login.isPending}>
            {login.isPending ? personal.signingIn : personal.signIn}
          </Button>
        </form>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="personal-pair-code">{m.pairingCode}</Label>
            <Input
              ref={codeRef}
              id="personal-pair-code"
              autoComplete="one-time-code"
              className="h-11 font-mono uppercase tracking-[0.18em]"
            />
          </div>
          <Button
            className="min-h-11 w-full"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? m.pairing : m.pair}
          </Button>
        </>
      )}
    </div>
  )
}

// Columns follow the panel, not the window: at a 1100px window the primary
// column is ~570px, where four columns truncated "32,877,394" to "32,877,3…".
// Hairlines come from the 1px gap over the rule colour, so a cell that wraps
// to a second row still gets its top rule.
function MetricStrip({ items }: { items: Array<{ label: string; value: string; hint?: string }> }) {
  return (
    <div className="@container">
      <dl className="grid gap-px overflow-hidden rounded-md border bg-border @xs:grid-cols-2 @2xl:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="min-w-0 bg-background p-4">
            <dt className="text-xs text-muted-foreground">{item.label}</dt>
            <dd className="mt-1 font-mono text-xl font-semibold tracking-tight tabular-nums [overflow-wrap:anywhere]">
              {/* A quota amount arrives as "CN¥22.51 · 11,254,946 quota", and
                  its raw quota is already this cell's hint — so with a hint the
                  big figure is the converted amount alone, not both twice. */}
              {item.hint ? item.value.split(" · ")[0] : item.value}
            </dd>
            {item.hint ? (
              <dd className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {item.hint}
              </dd>
            ) : null}
          </div>
        ))}
      </dl>
    </div>
  )
}

/** One label/value line in the account fact list — hairlines, not tiles. */
function FactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

function PersonalAccountView({
  instance,
  capabilities,
}: {
  instance: MoreTokenInstance
  capabilities: PersonalCapabilities
}) {
  const t = useT()
  const m = t.personal
  const management = t.management
  const queryClient = useQueryClient()
  const overview = useQuery({
    queryKey: ["more-token", instance.id, "personal-overview"],
    queryFn: () => request<PersonalOverview>(instance.id, { kind: "personalOverview" }),
  })
  const profile = useMutation({
    mutationFn: (displayName: string) =>
      request<PersonalAccount>(instance.id, {
        kind: "updatePersonalProfile",
        body: { display_name: displayName, email: overview.data?.account.email ?? "" },
      }),
    onSuccess: () => {
      toast.success(m.saveProfile)
      void queryClient.invalidateQueries({ queryKey: ["more-token", instance.id] })
    },
    onError: (error) => toast.error(errorText(error)),
  })
  if (overview.isError)
    return <PersonalError error={overview.error} retry={() => void overview.refetch()} />
  if (!overview.data) return <PersonalLoading />
  const info = overview.data
  const access = info.access ?? {
    group: info.account.group || "—",
    active_api_keys: 0,
    available_models: 0,
    last_login_at: info.account.last_login_at || 0,
  }
  const security = info.security ?? {
    two_factor_enabled: false,
    active_desktop_sessions: 0,
    auth_methods: ["password"],
  }
  const lifecycle = info.account.lifecycle_state || "active"
  const [statusTone, statusLabel] =
    lifecycle === "archived"
      ? (["bg-[var(--hm-neutral)]", management.archived] as const)
      : lifecycle === "closing"
        ? (["bg-[var(--hm-warn)]", management.closing] as const)
        : info.account.status === 1
          ? (["bg-[var(--hm-ok)]", management.enabled] as const)
          : (["bg-[var(--hm-warn)]", management.disabled] as const)
  const monogram = (info.account.display_name || info.account.username).trim().slice(0, 2)
  const available = quotaCurrencyParts(info.balance.available, info.quota_display)
  const usedShare =
    info.balance.total > 0
      ? Math.min(100, Math.round((info.balance.used / info.balance.total) * 100))
      : 0
  const profileEditable = !instance.readOnly && capabilities.features.profile_edit_enabled

  return (
    <div className="min-w-0 space-y-4">
      <section className="min-w-0 rounded-[var(--hm-radius-surface)] border">
        <div className="flex min-w-0 flex-wrap items-start gap-4 p-4">
          <span
            aria-hidden="true"
            className="flex size-11 shrink-0 items-center justify-center rounded-[var(--hm-radius-control)] border bg-muted text-sm font-medium uppercase"
          >
            {monogram}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-medium">
              {info.account.display_name || info.account.username}
            </h3>
            <p className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-2 font-mono text-xs text-muted-foreground">
              <span>@{info.account.username}</span>
              <span aria-hidden="true">·</span>
              <span className="[overflow-wrap:anywhere]">{info.account.email || "—"}</span>
            </p>
          </div>
          {capabilities.features.billing_portal_enabled ? (
            <Button
              variant="outline"
              size="sm"
              className="h-9 shrink-0"
              onClick={() => {
                try {
                  void openUrl(
                    sameOriginServerUrl(instance.baseUrl, capabilities.billing_portal_path)
                  )
                } catch (error) {
                  toast.error(errorText(error))
                }
              }}
            >
              <ExternalLink className="size-4" />
              {m.openBillingPortal}
            </Button>
          ) : null}
        </div>
        <dl className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2 border-t px-4 py-2.5 text-xs">
          <div className="flex min-w-0 items-center gap-2">
            <dt className="sr-only">{management.status}</dt>
            <dd className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`size-1.5 shrink-0 rounded-[var(--hm-radius-dot)] ${statusTone}`}
              />
              {statusLabel}
            </dd>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <dt className="shrink-0 text-muted-foreground">{m.accountGroup}</dt>
            <dd className="truncate font-medium">{access.group || "—"}</dd>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <dt className="shrink-0 text-muted-foreground">{m.memberOf}</dt>
            <dd className="truncate font-medium">
              {info.parent ? info.parent.display_name || info.parent.username : m.independent}
            </dd>
          </div>
        </dl>
      </section>

      <div className="grid min-w-0 gap-4 @2xl:grid-cols-2">
        <section
          aria-label={m.balanceSummary}
          className="min-w-0 rounded-[var(--hm-radius-surface)] border p-4"
        >
          <h3 className="text-sm font-medium">{m.balanceSummary}</h3>
          <p className="mt-3 text-xs text-muted-foreground">{m.available}</p>
          <p className="mt-1 font-mono text-2xl font-semibold tracking-tight tabular-nums [overflow-wrap:anywhere]">
            {available.primary}
          </p>
          {available.raw ? (
            <p className="mt-1 font-mono text-xs tabular-nums text-muted-foreground">
              {`${m.rawQuota}: ${formatNumber(info.balance.available)}`}
            </p>
          ) : null}
          <Progress value={usedShare} aria-label={m.used} className="mt-4 h-1.5" />
          <p className="mt-2 text-xs tabular-nums text-muted-foreground">
            {m.usedShare(`${usedShare}%`)}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t pt-3 text-xs">
            <div className="min-w-0">
              <dt className="text-muted-foreground">{m.used}</dt>
              <dd className="mt-0.5 font-mono tabular-nums [overflow-wrap:anywhere]">
                {quotaCurrencyParts(info.balance.used, info.quota_display).primary}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted-foreground">{m.total}</dt>
              <dd className="mt-0.5 font-mono tabular-nums [overflow-wrap:anywhere]">
                {quotaCurrencyParts(info.balance.total, info.quota_display).primary}
              </dd>
            </div>
          </dl>
        </section>

        <section
          aria-label={m.accessSummary}
          className="min-w-0 rounded-[var(--hm-radius-surface)] border p-4"
        >
          <h3 className="text-sm font-medium">{m.accessSummary}</h3>
          <dl className="mt-3 min-w-0 divide-y">
            <FactRow label={m.activeApiKeys}>
              <span className="font-mono tabular-nums">{formatNumber(access.active_api_keys)}</span>
            </FactRow>
            <FactRow label={m.desktopSessions}>
              <span className="font-mono tabular-nums">
                {formatNumber(security.active_desktop_sessions)}
              </span>
            </FactRow>
            <FactRow label={m.requests}>
              <span className="font-mono tabular-nums">
                {formatNumber(info.account.request_count)}
              </span>
            </FactRow>
            <FactRow label={m.lastLogin}>
              <span className="font-mono text-xs tabular-nums">
                {formatTime(access.last_login_at)}
              </span>
            </FactRow>
            <FactRow label={m.signInMethods}>
              <span className="flex flex-wrap justify-end gap-1">
                {security.auth_methods.map((method) => (
                  <Badge key={method} variant="outline" className="font-normal">
                    {method}
                  </Badge>
                ))}
              </span>
            </FactRow>
          </dl>
        </section>
      </div>

      <section className="min-w-0 rounded-[var(--hm-radius-surface)] border p-4">
        <h3 className="text-sm font-medium">{m.profile}</h3>
        <form
          className="mt-3 flex max-w-xl min-w-0 flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            profile.mutate(String(form.get("displayName") ?? ""))
          }}
        >
          <div className="min-w-[12rem] flex-1 space-y-1.5">
            <Label
              htmlFor="personal-display-name"
              className="text-xs font-normal text-muted-foreground"
            >
              {m.displayName}
            </Label>
            <Input
              id="personal-display-name"
              name="displayName"
              defaultValue={info.account.display_name}
              maxLength={32}
              disabled={!profileEditable}
            />
          </div>
          <Button
            type="submit"
            size="sm"
            className="h-9"
            disabled={profile.isPending || !profileEditable}
          >
            {m.saveProfile}
          </Button>
        </form>
        {profileEditable ? null : (
          <p className="mt-2 text-xs text-muted-foreground">
            {instance.readOnly ? management.readonlyBanner : m.profileEditDisabled}
          </p>
        )}
      </section>
    </div>
  )
}

function PersonalBalanceView({ instance }: { instance: MoreTokenInstance }) {
  const m = useT().personal
  const management = useT().management
  const [page, setPage] = useState(1)
  const [now] = useState(() => Math.floor(Date.now() / 1000))
  const pageSize = 25
  const balance = useQuery({
    queryKey: ["more-token", instance.id, "personal-balance"],
    queryFn: () => request<PersonalBalance>(instance.id, { kind: "personalBalance" }),
  })
  const ledger = useQuery({
    queryKey: ["more-token", instance.id, "personal-ledger", page],
    queryFn: () =>
      request<Page<PersonalLedgerEntry>>(instance.id, {
        kind: "personalLedger",
        page,
        pageSize,
      }),
  })
  if (balance.isError || ledger.isError)
    return (
      <PersonalError
        error={balance.error ?? ledger.error}
        retry={() => {
          void balance.refetch()
          void ledger.refetch()
        }}
      />
    )
  return (
    <div className="space-y-5">
      {balance.data?.quota_display.rate_valid_until &&
      balance.data.quota_display.rate_valid_until < now ? (
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertTitle>{management.exchangeRateExpired}</AlertTitle>
          <AlertDescription>{management.exchangeRateExpiredHint}</AlertDescription>
        </Alert>
      ) : null}
      {balance.data ? (
        <MetricStrip
          items={[
            {
              label: m.available,
              value: quotaCurrencyLabel(balance.data.available, balance.data.quota_display),
              hint: `${m.rawQuota}: ${formatNumber(balance.data.available)}`,
            },
            {
              label: m.used,
              value: quotaCurrencyLabel(balance.data.used, balance.data.quota_display),
              hint: `${m.rawQuota}: ${formatNumber(balance.data.used)}`,
            },
            {
              label: m.total,
              value: quotaCurrencyLabel(balance.data.total, balance.data.quota_display),
              hint: `${m.rawQuota}: ${formatNumber(balance.data.total)}`,
            },
            { label: m.requests, value: formatNumber(balance.data.request_count) },
          ]}
        />
      ) : (
        <PersonalLoading />
      )}
      <section className="overflow-hidden border-y">
        <div className="py-4">
          <h3 className="font-medium">{m.ledger}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{m.ledgerHint}</p>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{management.transactionType}</TableHead>
                <TableHead>{m.delta}</TableHead>
                <TableHead>{m.balanceAfter}</TableHead>
                <TableHead>{m.counterparty}</TableHead>
                <TableHead>{management.generatedAt}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(ledger.data?.items ?? []).map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{entry.type}</TableCell>
                  <TableCell
                    className={`font-mono tabular-nums ${entry.delta >= 0 ? "text-[var(--hm-ok)]" : "text-destructive"}`}
                  >
                    {entry.delta >= 0 ? "+" : ""}
                    {balance.data
                      ? quotaCurrencyLabel(entry.delta, balance.data.quota_display)
                      : formatNumber(entry.delta)}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {balance.data
                      ? quotaCurrencyLabel(entry.balance_after, balance.data.quota_display)
                      : formatNumber(entry.balance_after)}
                  </TableCell>
                  <TableCell>{entry.counterparty || "—"}</TableCell>
                  <TableCell>{formatTime(entry.created_at)}</TableCell>
                </TableRow>
              ))}
              {ledger.data && ledger.data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-28 text-center text-muted-foreground">
                    {m.noTransactions}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between gap-3 py-4 text-xs text-muted-foreground">
          <span>
            {m.pageSummary(page, Math.max(1, Math.ceil((ledger.data?.total ?? 0) / pageSize)))}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              {m.previousPage}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page * pageSize >= (ledger.data?.total ?? 0)}
              onClick={() => setPage(page + 1)}
            >
              {m.nextPage}
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}

function PersonalUsageView({ instance }: { instance: MoreTokenInstance }) {
  const t = useT()
  const m = t.personal
  const management = t.management
  const [now] = useState(() => Math.floor(Date.now() / 1000))
  const [days, setDays] = useState(30)
  const [model, setModel] = useState("")
  const [group, setGroup] = useState("")
  const [tokenName, setTokenName] = useState("")
  const [status, setStatus] = useState<"billable" | "success" | "refund" | "error" | "all">(
    "billable"
  )
  const [page, setPage] = useState(1)
  const pageSize = 25
  const buildUsageOperation = (targetPage: number, targetPageSize: number) => ({
    kind: "personalUsage" as const,
    start: now - days * 86400,
    end: now,
    model: model || null,
    group: group || null,
    tokenName: tokenName || null,
    status,
    page: targetPage,
    pageSize: targetPageSize,
  })
  const catalog = useQuery({
    queryKey: ["more-token", instance.id, "personal-models"],
    queryFn: () => request<PersonalModelCatalog>(instance.id, { kind: "personalModels" }),
  })
  const usage = useQuery({
    queryKey: [
      "more-token",
      instance.id,
      "personal-usage",
      days,
      model,
      group,
      tokenName,
      status,
      page,
    ],
    queryFn: () => request<PersonalUsage>(instance.id, buildUsageOperation(page, pageSize)),
    // A filter or page change keeps the last reply on screen (dimmed) instead of
    // flashing the whole view back to a skeleton.
    placeholderData: (previous) => previous,
  })
  const exportUsage = useMutation({
    mutationFn: async () => {
      const first = await request<PersonalUsage>(instance.id, buildUsageOperation(1, 200))
      const records = [...(first.records ?? [])]
      const pages = Math.ceil((first.total ?? 0) / 200)
      for (let exportPage = 2; exportPage <= pages; exportPage += 1) {
        const next = await request<PersonalUsage>(instance.id, buildUsageOperation(exportPage, 200))
        records.push(...(next.records ?? []))
      }
      return records
    },
    onSuccess: async (records) => {
      if (!usage.data) return
      await saveCsv(
        `more-token-usage-${new Date().toISOString().slice(0, 10)}.csv`,
        [
          [m.usageDefinition, usage.data.definition],
          [
            m.usageRange,
            `${new Date(usage.data.start * 1000).toISOString()} – ${new Date(usage.data.end * 1000).toISOString()}`,
          ],
          [m.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone],
          [m.generatedAt, new Date(usage.data.generated_at * 1000).toISOString()],
          [],
          [
            m.generatedAt,
            m.model,
            m.usageStatus,
            m.apiKey,
            m.accountGroup,
            m.promptTokens,
            m.completionTokens,
            m.rawQuota,
            m.duration,
            m.requestId,
          ],
          ...records.map((record) => [
            new Date(record.created_at * 1000).toISOString(),
            record.model_name,
            record.status,
            record.token_name,
            record.group,
            record.prompt_tokens,
            record.completion_tokens,
            record.quota,
            record.use_time,
            record.request_id,
          ]),
        ],
        { saved: management.csvSaved, failed: management.csvSaveFailed }
      )
    },
    onError: (error) => toast.error(errorText(error)),
  })
  // The toolbar stays through loading and errors: when a filter is what the
  // server rejected, changing that filter is the way out.
  const data = usage.data
  const max = Math.max(1, ...(data?.series ?? []).map((point) => Math.abs(point.quota)))
  const records = data?.records ?? []
  const modelBreakdown = data?.model_breakdown ?? []
  const currentPage = data?.page ?? page
  const currentPageSize = data?.page_size ?? pageSize
  const total = data?.total ?? records.length
  const pages = Math.max(1, Math.ceil(total / currentPageSize))
  // A selected filter the latest reply doesn't list (or that a failed reply
  // couldn't list) must still read as selected, not silently as "All".
  const withSelected = (options: string[] | undefined, selected: string) => {
    const list = options ?? []
    return selected && !list.includes(selected) ? [selected, ...list] : list
  }
  return (
    <div className="space-y-5">
      {/* The definition reads first, across the panel, and the filters follow
          as one wrapping toolbar. Side by side, the sentence was squeezed into
          a 180px column bottom-aligned against a 3×2 grid of selects. */}
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{m.usageDefinition}</p>
        <div className="flex min-w-0 flex-wrap items-center gap-2 [&>select]:h-9 [&>select]:min-w-0 [&>select]:max-w-full">
          <select
            aria-label={m.usageRange}
            value={days}
            onChange={(event) => {
              setDays(Number(event.target.value))
              setPage(1)
            }}
            className="rounded-md border bg-background px-3 text-sm"
          >
            <option value={7}>{m.usageDays(7)}</option>
            <option value={30}>{m.usageDays(30)}</option>
            <option value={90}>{m.usageDays(90)}</option>
          </select>
          <select
            aria-label={m.usageGroupFilter}
            value={group}
            onChange={(event) => {
              setGroup(event.target.value)
              setPage(1)
            }}
            className="rounded-md border bg-background px-3 text-sm"
          >
            <option value="">{m.allGroups}</option>
            {withSelected(data?.filter_options?.groups, group).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            aria-label={m.usageApiKeyFilter}
            value={tokenName}
            onChange={(event) => {
              setTokenName(event.target.value)
              setPage(1)
            }}
            className="rounded-md border bg-background px-3 text-sm"
          >
            <option value="">{m.allApiKeys}</option>
            {withSelected(data?.filter_options?.token_names, tokenName).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            aria-label={m.usageModelFilter}
            value={model}
            onChange={(event) => {
              setModel(event.target.value)
              setPage(1)
            }}
            className="rounded-md border bg-background px-3 text-sm"
          >
            <option value="">{m.allModels}</option>
            {withSelected(
              catalog.data?.items.map((item) => item.model_name),
              model
            ).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            aria-label={m.usageStatus}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as typeof status)
              setPage(1)
            }}
            className="rounded-md border bg-background px-3 text-sm"
          >
            <option value="billable">{m.statusBillable}</option>
            <option value="all">{m.statusAll}</option>
            <option value="success">{m.statusSuccess}</option>
            <option value="refund">{m.statusRefund}</option>
            <option value="error">{m.statusError}</option>
          </select>
          <Button
            variant="outline"
            className="sm:ml-auto"
            disabled={exportUsage.isPending || total === 0}
            title={total === 0 ? management.nothingToExport : undefined}
            onClick={() => exportUsage.mutate()}
          >
            <Download className="size-4" />
            {exportUsage.isPending ? m.exportingCsv : m.exportCsv}
          </Button>
        </div>
      </div>
      {usage.isError ? (
        <PersonalError error={usage.error} retry={() => void usage.refetch()} />
      ) : null}
      {data ? (
        <div
          aria-busy={usage.isPlaceholderData}
          className={cn(
            "space-y-5",
            usage.isPlaceholderData &&
              "opacity-60 transition-opacity duration-(--hm-dur-fast) ease-(--hm-ease-out)"
          )}
        >
          <MetricStrip
            items={[
              { label: m.requests, value: formatNumber(data.metrics.requests) },
              { label: m.promptTokens, value: formatNumber(data.metrics.prompt_tokens) },
              { label: m.completionTokens, value: formatNumber(data.metrics.completion_tokens) },
              {
                label: m.used,
                value: quotaCurrencyLabel(data.metrics.quota, data.quota_display),
                hint: `${m.rawQuota}: ${formatNumber(data.metrics.quota)}`,
              },
            ]}
          />
          <section className="border-y py-5">
            <div className="flex h-52 items-end gap-1" aria-label={m.usageDefinition}>
              {data.series.map((point) => (
                <div
                  key={point.bucket}
                  className={`min-w-1 flex-1 ${point.quota < 0 ? "bg-destructive/70" : "bg-primary/75"}`}
                  style={{ height: `${Math.max(2, (Math.abs(point.quota) / max) * 100)}%` }}
                  title={`${formatTime(point.bucket)} · ${formatNumber(point.quota)}`}
                />
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {m.generatedAt}: {formatTime(data.generated_at)}
            </p>
          </section>
          <section className="border-y py-5">
            <h3 className="font-medium">{m.modelBreakdown}</h3>
            <div className="mt-3 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{m.model}</TableHead>
                    <TableHead>{m.requests}</TableHead>
                    <TableHead>{m.promptTokens}</TableHead>
                    <TableHead>{m.completionTokens}</TableHead>
                    <TableHead>{m.used}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {modelBreakdown.map((item) => (
                    <TableRow key={item.model_name}>
                      <TableCell className="font-medium">{item.model_name || "—"}</TableCell>
                      <TableCell className="tabular-nums">{formatNumber(item.requests)}</TableCell>
                      <TableCell className="tabular-nums">
                        {formatNumber(item.prompt_tokens)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatNumber(item.completion_tokens)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {quotaCurrencyLabel(item.quota, data.quota_display)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
          <section className="border-y py-5">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h3 className="font-medium">{m.usageRecords}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{m.usageRecordsHint}</p>
              </div>
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatNumber(total)}
              </span>
            </div>
            <div className="mt-3 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{m.recordedAt}</TableHead>
                    <TableHead>{m.model}</TableHead>
                    <TableHead>{m.usageStatus}</TableHead>
                    <TableHead>{m.apiKey}</TableHead>
                    <TableHead>{m.accountGroup}</TableHead>
                    <TableHead>{m.promptTokens}</TableHead>
                    <TableHead>{m.completionTokens}</TableHead>
                    <TableHead>{m.used}</TableHead>
                    <TableHead>{m.duration}</TableHead>
                    <TableHead>{m.requestId}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((record) => (
                    <TableRow key={`${record.request_id}-${record.created_at}`}>
                      <TableCell className="whitespace-nowrap">
                        {formatTime(record.created_at)}
                      </TableCell>
                      <TableCell className="font-medium">{record.model_name || "—"}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            record.status === "error"
                              ? "destructive"
                              : record.status === "refund"
                                ? "outline"
                                : "secondary"
                          }
                        >
                          {record.status === "success"
                            ? m.statusSuccess
                            : record.status === "refund"
                              ? m.statusRefund
                              : record.status === "error"
                                ? m.statusError
                                : record.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{record.token_name || "—"}</TableCell>
                      <TableCell>{record.group || "—"}</TableCell>
                      <TableCell className="tabular-nums">
                        {formatNumber(record.prompt_tokens)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatNumber(record.completion_tokens)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {quotaCurrencyLabel(record.quota, data.quota_display)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {m.durationMs(formatNumber(record.use_time))}
                      </TableCell>
                      <TableCell className="max-w-48 truncate font-mono text-xs">
                        {record.request_id || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {records.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="h-28 text-center text-muted-foreground">
                        {m.noUsageRecords}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <span className="mr-2 text-xs tabular-nums text-muted-foreground">
                {m.pageSummary(currentPage, pages)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                {m.previousPage}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= pages}
                onClick={() => setPage((current) => current + 1)}
              >
                {m.nextPage}
              </Button>
            </div>
          </section>
        </div>
      ) : usage.isError ? null : (
        <PersonalLoading />
      )}
    </div>
  )
}

function PersonalModelsView({ instance }: { instance: MoreTokenInstance }) {
  const m = useT().personal
  const [search, setSearch] = useState("")
  const [vendor, setVendor] = useState("all")
  const [billing, setBilling] = useState<"all" | "ratio" | "fixed">("all")
  const [selectedModel, setSelectedModel] = useState<PersonalModel | null>(null)
  const catalog = useQuery({
    queryKey: ["more-token", instance.id, "personal-models"],
    queryFn: () => request<PersonalModelCatalog>(instance.id, { kind: "personalModels" }),
  })
  const vendors = useMemo(
    () => new Map((catalog.data?.vendors ?? []).map((vendor) => [vendor.id, vendor.name])),
    [catalog.data?.vendors]
  )
  const items = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (catalog.data?.items ?? []).filter((model) => {
      const matchesSearch =
        !needle ||
        [model.model_name, model.description, model.tags, vendors.get(model.vendor_id ?? 0)]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(needle))
      const matchesVendor = vendor === "all" || String(model.vendor_id ?? 0) === vendor
      const matchesBilling =
        billing === "all" || (billing === "fixed" ? model.quota_type === 1 : model.quota_type !== 1)
      return matchesSearch && matchesVendor && matchesBilling
    })
  }, [billing, catalog.data?.items, search, vendor, vendors])
  if (catalog.isError)
    return <PersonalError error={catalog.error} retry={() => void catalog.refetch()} />
  if (!catalog.data) return <PersonalLoading />
  return (
    <div className="space-y-5">
      {/* Heading over toolbar, not beside it: side by side in the primary
          column the heading wrapped to four lines and the third control ran
          past the panel's right edge. */}
      <div className="flex flex-col gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-medium">
            <Orbit className="size-4" />
            {m.modelMarketplace}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{m.modelMarketplaceHint}</p>
        </div>
        <div className="grid w-full gap-2 sm:grid-cols-[minmax(12rem,1fr)_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={m.searchModels}
              className="h-9 pl-9"
            />
          </div>
          <select
            aria-label={m.modelVendorFilter}
            value={vendor}
            onChange={(event) => setVendor(event.target.value)}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">{m.allVendors}</option>
            {catalog.data.vendors.map((item) => (
              <option key={item.id} value={String(item.id)}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            aria-label={m.billingTypeFilter}
            value={billing}
            onChange={(event) => setBilling(event.target.value as typeof billing)}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">{m.allBillingTypes}</option>
            <option value="ratio">{m.ratioBilling}</option>
            <option value="fixed">{m.fixedPrice}</option>
          </select>
        </div>
      </div>
      <MetricStrip
        items={[
          { label: m.modelMarketplace, value: formatNumber(catalog.data.items.length) },
          { label: m.vendor, value: formatNumber(catalog.data.vendors.length) },
          {
            label: m.accountGroup,
            value: Object.values(catalog.data.usable_group).join(", ") || "—",
          },
          { label: m.generatedAt, value: formatTime(catalog.data.generated_at) },
        ]}
      />
      <section className="overflow-hidden border-y">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{m.model}</TableHead>
                <TableHead>{m.vendor}</TableHead>
                <TableHead>{m.billing}</TableHead>
                <TableHead>{m.endpoints}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((model) => (
                <TableRow key={model.model_name}>
                  <TableCell className="min-w-64">
                    <Button
                      variant="link"
                      className="h-auto min-h-11 p-0 text-left font-medium"
                      onClick={() => setSelectedModel(model)}
                    >
                      {model.model_name}
                    </Button>
                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                      {model.description || model.tags || "—"}
                    </p>
                  </TableCell>
                  <TableCell>{vendors.get(model.vendor_id ?? 0) || "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm tabular-nums">
                    {model.quota_type === 1
                      ? `${m.fixedPrice} · ${model.model_price}`
                      : `${m.ratioBilling} · ${model.model_ratio}× / ${model.completion_ratio}×`}
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-72 flex-wrap gap-1">
                      {(model.supported_endpoint_types ?? []).map((endpoint) => (
                        <Badge key={endpoint} variant="outline">
                          {endpoint}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-28 text-center text-muted-foreground">
                    {m.noModels}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </section>
      <Dialog
        open={selectedModel !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedModel(null)
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedModel?.model_name ?? m.modelDetails}</DialogTitle>
            <DialogDescription>
              {selectedModel?.description || selectedModel?.tags || m.modelMarketplaceHint}
            </DialogDescription>
          </DialogHeader>
          {selectedModel ? (
            <div className="divide-y border-y text-sm">
              <div className="grid gap-2 py-4 sm:grid-cols-[10rem_1fr]">
                <span className="text-muted-foreground">{m.vendor}</span>
                <span className="font-medium">
                  {vendors.get(selectedModel.vendor_id ?? 0) || "—"}
                </span>
              </div>
              {selectedModel.owner_by || selectedModel.billing_mode ? (
                <div className="grid gap-3 py-4 sm:grid-cols-[10rem_1fr]">
                  <span className="text-muted-foreground">{m.billing}</span>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {selectedModel.owner_by ? (
                      <span>
                        {m.modelOwner}: {selectedModel.owner_by}
                      </span>
                    ) : null}
                    {selectedModel.billing_mode ? (
                      <span>
                        {m.billingMode}: {selectedModel.billing_mode}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <div className="grid gap-3 py-4 sm:grid-cols-[10rem_1fr]">
                <span className="text-muted-foreground">{m.pricingDetails}</span>
                <div className="grid gap-2 tabular-nums sm:grid-cols-2">
                  {selectedModel.quota_type === 1 ? (
                    <span>
                      {m.fixedPrice}: {selectedModel.model_price}
                    </span>
                  ) : (
                    <>
                      <span>
                        {m.inputRatio}: {selectedModel.model_ratio}×
                      </span>
                      <span>
                        {m.outputRatio}: {selectedModel.completion_ratio}×
                      </span>
                      {selectedModel.cache_ratio !== undefined ? (
                        <span>
                          {m.cacheRatio}: {selectedModel.cache_ratio}×
                        </span>
                      ) : null}
                      {selectedModel.create_cache_ratio !== undefined ? (
                        <span>
                          {m.cacheWriteRatio}: {selectedModel.create_cache_ratio}×
                        </span>
                      ) : null}
                      {selectedModel.image_ratio !== undefined ? (
                        <span>
                          {m.imageRatio}: {selectedModel.image_ratio}×
                        </span>
                      ) : null}
                      {selectedModel.audio_ratio !== undefined ? (
                        <span>
                          {m.audioRatio}: {selectedModel.audio_ratio}×
                        </span>
                      ) : null}
                      {selectedModel.audio_completion_ratio !== undefined ? (
                        <span>
                          {m.audioCompletionRatio}: {selectedModel.audio_completion_ratio}×
                        </span>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
              <div className="grid gap-3 py-4 sm:grid-cols-[10rem_1fr]">
                <span className="text-muted-foreground">{m.groups}</span>
                <div className="flex flex-wrap gap-1">
                  {selectedModel.enable_groups.map((group) => (
                    <Badge key={group} variant="secondary">
                      {catalog.data.usable_group[group] || group}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 py-4 sm:grid-cols-[10rem_1fr]">
                <span className="text-muted-foreground">{m.endpointDetails}</span>
                <div className="space-y-2">
                  {selectedModel.supported_endpoint_types.map((endpoint) => {
                    const detail = catalog.data.supported_endpoint[endpoint]
                    return (
                      <div key={endpoint} className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{endpoint}</Badge>
                        {detail ? (
                          <code className="text-xs text-muted-foreground">
                            {detail.method} {detail.path}
                          </code>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>
              {selectedModel.tags ? (
                <div className="flex flex-wrap gap-1 py-4">
                  {selectedModel.tags.split(",").map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag.trim()}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PersonalSecurityView({
  instance,
  capabilities,
}: {
  instance: MoreTokenInstance
  capabilities: PersonalCapabilities
}) {
  const t = useT()
  const m = t.personal
  const management = t.management
  const queryClient = useQueryClient()
  const overview = useQuery({
    queryKey: ["more-token", instance.id, "personal-overview"],
    queryFn: () => request<PersonalOverview>(instance.id, { kind: "personalOverview" }),
  })
  const sessions = useQuery({
    queryKey: ["more-token", instance.id, "personal-sessions"],
    queryFn: () => request<PersonalSession[]>(instance.id, { kind: "personalSessions" }),
  })
  // The server has already revoked every desktop session for this user, this
  // one included, so only the local copy is left to delete — and the cached
  // profile and balance go with it (design.md § 10).
  const signOutLocally = async () => {
    try {
      await forgetCredential(instance.id, true)
    } catch (error) {
      toast.error(errorText(error))
    }
    await resetInstanceQueries(queryClient, instance.id)
  }
  const revoke = useMutation({
    mutationFn: (id: number) => request(instance.id, { kind: "revokePersonalSession", id }),
    onSuccess: () => {
      toast.success(m.revoked)
      void sessions.refetch()
    },
    onError: (error) => toast.error(errorText(error)),
  })
  const password = useMutation({
    mutationFn: (body: PersonalPasswordBody) =>
      request(instance.id, { kind: "changePersonalPassword", body }),
    onSuccess: async () => {
      toast.success(m.changePassword)
      await signOutLocally()
    },
    onError: (error) => toast.error(errorText(error)),
  })
  const close = useMutation({
    mutationFn: (body: PersonalCloseBody) =>
      request(instance.id, { kind: "closePersonalAccount", body }),
    onSuccess: async () => {
      toast.success(m.closeAccount)
      await signOutLocally()
    },
    onError: (error) => toast.error(errorText(error)),
  })
  const readOnlyNote = instance.readOnly ? management.readonlyBanner : null
  const passwordBlocked = capabilities.features.password_change_enabled
    ? readOnlyNote
    : m.passwordChangeDisabled
  const closeBlocked = capabilities.features.account_close_enabled
    ? readOnlyNote
    : m.accountCloseDisabled
  return (
    <div className="divide-y border-y">
      <section className="py-5">
        <h3 className="font-medium">{m.sessions}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{m.sessionsHint}</p>
        {readOnlyNote ? <p className="mt-1 text-xs text-muted-foreground">{readOnlyNote}</p> : null}
        <div className="mt-4">
          {sessions.isError ? (
            <PersonalError error={sessions.error} retry={() => void sessions.refetch()} />
          ) : sessions.isLoading ? (
            <Skeleton className="h-16" aria-busy="true" />
          ) : !sessions.data?.length ? (
            <p className="text-sm text-muted-foreground">{m.noSessions}</p>
          ) : (
            <div className="divide-y rounded-md border">
              {sessions.data.map((session) => {
                // Revoking the session this desktop is using would leave the
                // app holding a dead credential that still reads "connected";
                // signing this desktop out is Forget credential's job.
                const current = session.id === capabilities.current_session_id
                return (
                  <div
                    key={session.id}
                    className="flex flex-col justify-between gap-3 p-3 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {session.client_label || session.client_id}
                        {current ? <Badge variant="outline">{m.currentSession}</Badge> : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatTime(session.last_used_at || session.created_at)} ·{" "}
                        {formatTime(session.expires_at)}
                      </p>
                      {current && !session.revoked_at ? (
                        <p className="mt-1 text-xs text-muted-foreground">{m.currentSessionHint}</p>
                      ) : null}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={
                        current || session.revoked_at > 0 || revoke.isPending || instance.readOnly
                      }
                      onClick={() => revoke.mutate(session.id)}
                    >
                      {session.revoked_at ? m.revoked : m.revokeSession}
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>
      <section className="py-5">
        <h3 className="font-medium">{m.password}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{m.reauthentication}</p>
        <form
          className="mt-4 grid max-w-2xl gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            password.mutate({
              current_password: String(form.get("currentPassword") ?? ""),
              new_password: String(form.get("newPassword") ?? ""),
            })
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="current-password">{m.currentPassword}</Label>
            <Input
              id="current-password"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">{m.newPassword}</Label>
            <Input
              id="new-password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={20}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button
              type="submit"
              size="sm"
              disabled={password.isPending || passwordBlocked !== null}
            >
              {m.changePassword}
            </Button>
            {passwordBlocked ? (
              <p className="text-xs text-muted-foreground">{passwordBlocked}</p>
            ) : null}
          </div>
        </form>
      </section>
      <section className="py-5">
        <h3 className="font-medium text-destructive">{m.closeAccount}</h3>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{m.closeHint}</p>
        {overview.data?.account.master_id === 0 && (overview.data?.balance.available ?? 0) > 0 ? (
          <Alert className="mt-4">
            <AlertTriangle className="size-4" />
            <AlertDescription>{m.closeBlockedBalance}</AlertDescription>
          </Alert>
        ) : null}
        <form
          className="mt-4 grid max-w-2xl gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            close.mutate({
              operation_id: operationId(),
              current_password: String(form.get("closePassword") ?? ""),
              confirm_username: String(form.get("confirmUsername") ?? ""),
              reason: String(form.get("reason") ?? ""),
            })
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="close-password">{m.currentPassword}</Label>
            <Input
              id="close-password"
              name="closePassword"
              type="password"
              autoComplete="current-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-username">{m.confirmUsername}</Label>
            <Input
              id="confirm-username"
              name="confirmUsername"
              placeholder={overview.data?.account.username}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="close-reason">{m.closeReason}</Label>
            <Textarea id="close-reason" name="reason" />
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button
              type="submit"
              variant="destructive"
              size="sm"
              disabled={close.isPending || closeBlocked !== null}
            >
              {m.closeAccount}
            </Button>
            {closeBlocked ? <p className="text-xs text-muted-foreground">{closeBlocked}</p> : null}
          </div>
        </form>
      </section>
    </div>
  )
}
