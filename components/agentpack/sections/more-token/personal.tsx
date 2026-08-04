"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  Check,
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { openUrl } from "@/lib/tauri/system"
import {
  cancelPersonalOAuth,
  credentialState,
  downloadCsv,
  forgetCredential,
  listInstances,
  loginPersonalInstance,
  managementRequest,
  ManagementApiError,
  operationId,
  pairInstance,
  pollPersonalOAuth,
  quotaCurrencyLabel,
  saveInstance,
  startPersonalOAuth,
} from "@/lib/more-token/client"
import type {
  CredentialState,
  MoreTokenInstance,
  Page,
  PersonalAccount,
  PersonalBalance,
  PersonalCapabilities,
  PersonalLedgerEntry,
  PersonalModel,
  PersonalModelCatalog,
  PersonalOverview,
  PersonalSession,
  PersonalUsage,
  PersonalView,
} from "@/lib/more-token/types"
import { DesktopOnlyNote } from "../../desktop-only-note"
import { SectionShell } from "../section-shell"

const PERSONAL_CLIENT_ID = "agentpack-personal-desktop"

/* Hallmark · pre-emit critique: P5 H4 E4 S5 R4 V4
 * component: personal-workspace · genre: modern-minimal · theme: existing Cobalt/Geist
 */

function request<T>(instanceId: string, operation: Parameters<typeof managementRequest>[1]) {
  return managementRequest<T>(instanceId, operation).then((response) => response.data)
}

function errorText(error: unknown): string {
  if (error instanceof ManagementApiError) return `${error.code}: ${error.message}`
  return error instanceof Error ? error.message : String(error)
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

export function PersonalMoreTokenSection({ view }: { view: PersonalView }) {
  const m = useT()
  const personal = m.personal
  const management = m.management
  const queryClient = useQueryClient()
  const tauri = isTauri()
  const [selectedId, setSelectedId] = useState("")
  const [instanceOpen, setInstanceOpen] = useState(false)
  const instancesQuery = useQuery({
    queryKey: ["more-token", "instances"],
    queryFn: listInstances,
    enabled: tauri,
    staleTime: Infinity,
  })
  const instances = (instancesQuery.data ?? []).filter(
    (instance) => instance.package === "personal"
  )
  const activeId = selectedId || instances[0]?.id || ""
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
      <SectionShell title={personal.title} subtitle={personal.subtitle} wide>
        <DesktopOnlyNote>{management.desktopOnly}</DesktopOnlyNote>
      </SectionShell>
    )
  }

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["more-token", activeId] })
  const actions = (
    <div className="flex items-center gap-2">
      {instances.length ? (
        <select
          aria-label={management.instance}
          value={activeId}
          onChange={(event) => setSelectedId(event.target.value)}
          className="h-9 max-w-52 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {instances.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      ) : null}
      <Button variant="outline" size="sm" onClick={() => setInstanceOpen(true)}>
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

  return (
    <SectionShell
      title={personal.tabs[view.replace("my-", "") as keyof typeof personal.tabs]}
      subtitle={personal.subtitle}
      actions={actions}
      wide
    >
      <Alert>
        <ShieldCheck className="size-4" />
        <AlertTitle>{personal.packageLabel}</AlertTitle>
        <AlertDescription>{personal.isolationNote}</AlertDescription>
      </Alert>
      {instancesQuery.isLoading ? (
        <PersonalLoading />
      ) : instances.length === 0 ? (
        <FlatEmpty text={management.noInstances} action={() => setInstanceOpen(true)} />
      ) : credential.isLoading ? (
        <PersonalLoading />
      ) : credential.data?.connected !== true ? (
        <PersonalPairPanel instance={instance!} onPaired={() => void credential.refetch()} />
      ) : capabilities.isError ? (
        <PersonalError error={capabilities.error} retry={() => void capabilities.refetch()} />
      ) : capabilities.data ? (
        <div className="space-y-5">
          <PersonalInstanceBar
            instance={instance!}
            credential={credential.data}
            capabilities={capabilities.data}
            onDisconnect={async () => {
              await forgetCredential(activeId)
              await credential.refetch()
            }}
          />
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
      )}
      <PersonalInstanceDialog
        open={instanceOpen}
        onOpenChange={setInstanceOpen}
        onSaved={async (saved) => {
          await queryClient.invalidateQueries({ queryKey: ["more-token", "instances"] })
          setSelectedId(saved.id)
        }}
      />
    </SectionShell>
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
  useEffect(() => {
    if (!oauth) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const result = await pollPersonalOAuth(instance.id, oauth.handle)
        if (cancelled) return
        if (result.status === "authorized" && result.credential) {
          toast.success(
            result.credential.credentialPersistent ? m.persistentCredential : m.memoryCredential
          )
          onPaired()
          return
        }
        timer = setTimeout(poll, (result.status === "slow_down" ? 6 : oauth.intervalSeconds) * 1000)
      } catch (error) {
        if (!cancelled) {
          setOauth(null)
          toast.error(errorText(error))
        }
      }
    }
    timer = setTimeout(poll, oauth.intervalSeconds * 1000)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      void cancelPersonalOAuth(instance.id, oauth.handle).catch(() => undefined)
    }
  }, [instance.id, m.memoryCredential, m.persistentCredential, oauth, onPaired])
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
          onClick={() => setMode("browser")}
        >
          {personal.browserOption}
        </Button>
        <Button
          type="button"
          variant={mode === "password" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setMode("password")}
        >
          {personal.passwordOption}
        </Button>
        <Button
          type="button"
          variant={mode === "pairing" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setMode("pairing")}
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

function PersonalInstanceBar({
  instance,
  credential,
  capabilities,
  onDisconnect,
}: {
  instance: MoreTokenInstance
  credential: CredentialState
  capabilities: PersonalCapabilities
  onDisconnect: () => void
}) {
  const m = useT()
  return (
    <div className="flex flex-col gap-3 border-y py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-md bg-[var(--hm-ok-soft)] text-[var(--hm-ok)]">
          <Check className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">{instance.name}</p>
            <Badge variant="outline">{m.management.healthy}</Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {instance.baseUrl} · Personal API v{capabilities.personal_api_version}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {credential.persistent
            ? m.management.persistentCredential
            : m.management.memoryCredential}
        </span>
        <Button variant="ghost" size="sm" onClick={onDisconnect}>
          <Unplug className="size-4" />
          {m.management.disconnect}
        </Button>
      </div>
    </div>
  )
}

function MetricStrip({ items }: { items: Array<{ label: string; value: string; hint?: string }> }) {
  return (
    <dl className="grid overflow-hidden rounded-md border sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item, index) => (
        <div
          key={item.label}
          className={`min-w-0 p-4 ${index ? "border-t sm:border-l sm:border-t-0" : ""}`}
        >
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 truncate text-xl font-semibold tabular-nums">{item.value}</dd>
          {item.hint ? (
            <dd className="mt-1 truncate text-xs text-muted-foreground">{item.hint}</dd>
          ) : null}
        </div>
      ))}
    </dl>
  )
}

function PersonalAccountView({
  instance,
  capabilities,
}: {
  instance: MoreTokenInstance
  capabilities: PersonalCapabilities
}) {
  const m = useT().personal
  const queryClient = useQueryClient()
  const overview = useQuery({
    queryKey: ["more-token", instance.id, "personal-overview"],
    queryFn: () => request<PersonalOverview>(instance.id, { kind: "personalOverview" }),
  })
  const profile = useMutation({
    mutationFn: (displayName: string) =>
      request<PersonalAccount>(instance.id, {
        kind: "updatePersonalProfile",
        body: { display_name: displayName },
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
  return (
    <div className="space-y-5">
      <MetricStrip
        items={[
          {
            label: m.available,
            value: quotaCurrencyLabel(info.balance.available, info.quota_display),
            hint: `${m.rawQuota}: ${formatNumber(info.balance.available)}`,
          },
          {
            label: m.used,
            value: quotaCurrencyLabel(info.balance.used, info.quota_display),
            hint: `${m.rawQuota}: ${formatNumber(info.balance.used)}`,
          },
          {
            label: m.total,
            value: quotaCurrencyLabel(info.balance.total, info.quota_display),
            hint: `${m.rawQuota}: ${formatNumber(info.balance.total)}`,
          },
          { label: m.requests, value: formatNumber(info.account.request_count) },
        ]}
      />
      <MetricStrip
        items={[
          { label: m.accountGroup, value: access.group || "—" },
          { label: m.activeApiKeys, value: formatNumber(access.active_api_keys) },
          { label: m.desktopSessions, value: formatNumber(security.active_desktop_sessions) },
          { label: m.lastLogin, value: formatTime(access.last_login_at) },
        ]}
      />
      <div className="grid border-y lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
        <section className="space-y-4 py-5 lg:pr-6">
          <div>
            <h3 className="font-medium">{m.profile}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              @{info.account.username} · {info.account.email || "—"}
            </p>
          </div>
          <form
            className="max-w-lg space-y-3"
            onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              profile.mutate(String(form.get("displayName") ?? ""))
            }}
          >
            <Label htmlFor="personal-display-name">{m.displayName}</Label>
            <Input
              id="personal-display-name"
              name="displayName"
              defaultValue={info.account.display_name}
              maxLength={32}
              disabled={instance.readOnly || !capabilities.features.profile_edit_enabled}
            />
            <Button type="submit" size="sm" disabled={profile.isPending || instance.readOnly}>
              {m.saveProfile}
            </Button>
          </form>
        </section>
        <aside className="space-y-4 border-t py-5 lg:border-l lg:border-t-0 lg:pl-6">
          <div>
            <p className="text-xs text-muted-foreground">{m.memberOf}</p>
            <p className="mt-1 text-sm font-medium">
              {info.parent ? info.parent.display_name || info.parent.username : m.independent}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{m.signInMethods}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {security.auth_methods.map((method) => (
                <Badge key={method} variant="outline">
                  {method}
                </Badge>
              ))}
            </div>
          </div>
          {capabilities.features.billing_portal_enabled ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void openUrl(new URL(capabilities.billing_portal_path, instance.baseUrl).toString())
              }
            >
              <ExternalLink className="size-4" />
              {m.openBillingPortal}
            </Button>
          ) : null}
        </aside>
      </div>
    </div>
  )
}

function PersonalBalanceView({ instance }: { instance: MoreTokenInstance }) {
  const m = useT().personal
  const management = useT().management
  const balance = useQuery({
    queryKey: ["more-token", instance.id, "personal-balance"],
    queryFn: () => request<PersonalBalance>(instance.id, { kind: "personalBalance" }),
  })
  const ledger = useQuery({
    queryKey: ["more-token", instance.id, "personal-ledger"],
    queryFn: () =>
      request<Page<PersonalLedgerEntry>>(instance.id, {
        kind: "personalLedger",
        page: 1,
        pageSize: 50,
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
      </section>
    </div>
  )
}

function PersonalUsageView({ instance }: { instance: MoreTokenInstance }) {
  const m = useT().personal
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
    onSuccess: (records) => {
      if (!usage.data) return
      downloadCsv(`more-token-usage-${new Date().toISOString().slice(0, 10)}.csv`, [
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
      ])
    },
    onError: (error) => toast.error(errorText(error)),
  })
  if (usage.isError) return <PersonalError error={usage.error} retry={() => void usage.refetch()} />
  if (!usage.data) return <PersonalLoading />
  const max = Math.max(1, ...usage.data.series.map((point) => Math.abs(point.quota)))
  const records = usage.data.records ?? []
  const modelBreakdown = usage.data.model_breakdown ?? []
  const currentPage = usage.data.page ?? page
  const currentPageSize = usage.data.page_size ?? pageSize
  const total = usage.data.total ?? records.length
  const pages = Math.max(1, Math.ceil(total / currentPageSize))
  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <p className="text-sm text-muted-foreground">{m.usageDefinition}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <select
            aria-label={m.usageRange}
            value={days}
            onChange={(event) => {
              setDays(Number(event.target.value))
              setPage(1)
            }}
            className="h-11 rounded-md border bg-background px-3 text-sm"
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
            className="h-11 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">{m.allGroups}</option>
            {(usage.data?.filter_options?.groups ?? []).map((item) => (
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
            className="h-11 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">{m.allApiKeys}</option>
            {(usage.data?.filter_options?.token_names ?? []).map((item) => (
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
            className="h-11 min-w-40 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">{m.allModels}</option>
            {(catalog.data?.items ?? []).map((item) => (
              <option key={item.model_name} value={item.model_name}>
                {item.model_name}
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
            className="h-11 rounded-md border bg-background px-3 text-sm"
          >
            <option value="billable">{m.statusBillable}</option>
            <option value="all">{m.statusAll}</option>
            <option value="success">{m.statusSuccess}</option>
            <option value="refund">{m.statusRefund}</option>
            <option value="error">{m.statusError}</option>
          </select>
          <Button
            variant="outline"
            className="h-11"
            disabled={exportUsage.isPending || total === 0}
            onClick={() => exportUsage.mutate()}
          >
            <Download className="size-4" />
            {exportUsage.isPending ? m.exportingCsv : m.exportCsv}
          </Button>
        </div>
      </div>
      <MetricStrip
        items={[
          { label: m.requests, value: formatNumber(usage.data.metrics.requests) },
          { label: m.promptTokens, value: formatNumber(usage.data.metrics.prompt_tokens) },
          { label: m.completionTokens, value: formatNumber(usage.data.metrics.completion_tokens) },
          {
            label: m.used,
            value: quotaCurrencyLabel(usage.data.metrics.quota, usage.data.quota_display),
            hint: `${m.rawQuota}: ${formatNumber(usage.data.metrics.quota)}`,
          },
        ]}
      />
      <section className="border-y py-5">
        <div className="flex h-52 items-end gap-1" aria-label={m.usageDefinition}>
          {usage.data.series.map((point) => (
            <div
              key={point.bucket}
              className={`min-w-1 flex-1 ${point.quota < 0 ? "bg-destructive/70" : "bg-primary/75"}`}
              style={{ height: `${Math.max(2, (Math.abs(point.quota) / max) * 100)}%` }}
              title={`${formatTime(point.bucket)} · ${formatNumber(point.quota)}`}
            />
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {m.generatedAt}: {formatTime(usage.data.generated_at)}
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
                  <TableCell className="tabular-nums">{formatNumber(item.prompt_tokens)}</TableCell>
                  <TableCell className="tabular-nums">
                    {formatNumber(item.completion_tokens)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {quotaCurrencyLabel(item.quota, usage.data.quota_display)}
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
          <span className="text-xs tabular-nums text-muted-foreground">{formatNumber(total)}</span>
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
                    {quotaCurrencyLabel(record.quota, usage.data.quota_display)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {formatNumber(record.use_time)} ms
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 font-medium">
            <Orbit className="size-4" />
            {m.modelMarketplace}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{m.modelMarketplaceHint}</p>
        </div>
        <div className="grid w-full gap-2 sm:max-w-2xl sm:grid-cols-[minmax(12rem,1fr)_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={m.searchModels}
              className="h-11 pl-9"
            />
          </div>
          <select
            aria-label={m.modelVendorFilter}
            value={vendor}
            onChange={(event) => setVendor(event.target.value)}
            className="h-11 rounded-md border bg-background px-3 text-sm"
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
            className="h-11 rounded-md border bg-background px-3 text-sm"
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
  const m = useT().personal
  const queryClient = useQueryClient()
  const overview = useQuery({
    queryKey: ["more-token", instance.id, "personal-overview"],
    queryFn: () => request<PersonalOverview>(instance.id, { kind: "personalOverview" }),
  })
  const sessions = useQuery({
    queryKey: ["more-token", instance.id, "personal-sessions"],
    queryFn: () => request<PersonalSession[]>(instance.id, { kind: "personalSessions" }),
  })
  const revoke = useMutation({
    mutationFn: (id: number) => request(instance.id, { kind: "revokePersonalSession", id }),
    onSuccess: () => {
      toast.success(m.revoked)
      void sessions.refetch()
    },
    onError: (error) => toast.error(errorText(error)),
  })
  const password = useMutation({
    mutationFn: (body: unknown) => request(instance.id, { kind: "changePersonalPassword", body }),
    onSuccess: async () => {
      toast.success(m.changePassword)
      await forgetCredential(instance.id)
      void queryClient.invalidateQueries({ queryKey: ["more-token", instance.id] })
    },
    onError: (error) => toast.error(errorText(error)),
  })
  const close = useMutation({
    mutationFn: (body: unknown) => request(instance.id, { kind: "closePersonalAccount", body }),
    onSuccess: async () => {
      toast.success(m.closeAccount)
      await forgetCredential(instance.id)
      void queryClient.invalidateQueries({ queryKey: ["more-token", instance.id] })
    },
    onError: (error) => toast.error(errorText(error)),
  })
  return (
    <div className="divide-y border-y">
      <section className="py-5">
        <h3 className="font-medium">{m.sessions}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{m.sessionsHint}</p>
        <div className="mt-4 divide-y rounded-md border">
          {(sessions.data ?? []).map((session) => (
            <div
              key={session.id}
              className="flex flex-col justify-between gap-3 p-3 sm:flex-row sm:items-center"
            >
              <div>
                <p className="text-sm font-medium">{session.client_label || session.client_id}</p>
                <p className="text-xs text-muted-foreground">
                  {formatTime(session.last_used_at || session.created_at)} ·{" "}
                  {formatTime(session.expires_at)}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={session.revoked_at > 0 || revoke.isPending || instance.readOnly}
                onClick={() => revoke.mutate(session.id)}
              >
                {session.revoked_at ? m.revoked : m.revokeSession}
              </Button>
            </div>
          ))}
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
              current_password: form.get("currentPassword"),
              new_password: form.get("newPassword"),
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
          <Button
            type="submit"
            size="sm"
            className="sm:col-span-2 sm:w-fit"
            disabled={
              password.isPending ||
              instance.readOnly ||
              !capabilities.features.password_change_enabled
            }
          >
            {m.changePassword}
          </Button>
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
              current_password: form.get("closePassword"),
              confirm_username: form.get("confirmUsername"),
              reason: form.get("reason"),
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
          <Button
            type="submit"
            variant="destructive"
            size="sm"
            className="sm:col-span-2 sm:w-fit"
            disabled={
              close.isPending || instance.readOnly || !capabilities.features.account_close_enabled
            }
          >
            {m.closeAccount}
          </Button>
        </form>
      </section>
    </div>
  )
}

function PersonalInstanceDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (instance: MoreTokenInstance) => void
}) {
  const m = useT().management
  const mutation = useMutation({
    mutationFn: async (form: HTMLFormElement) => {
      const values = new FormData(form)
      return saveInstance({
        id: `personal-${Date.now()}`,
        name: String(values.get("name") ?? ""),
        baseUrl: String(values.get("baseUrl") ?? ""),
        customCaPath: String(values.get("customCaPath") ?? "") || null,
        clearCustomCa: false,
        readOnly: values.get("readOnly") === "on",
        displayCurrency: null,
        package: "personal",
      })
    },
    onSuccess: (instance) => {
      onOpenChange(false)
      onSaved(instance)
    },
    onError: (error) => toast.error(errorText(error)),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.addInstance}</DialogTitle>
          <DialogDescription>{useT().personal.isolationNote}</DialogDescription>
        </DialogHeader>
        <form
          id="personal-instance-form"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            mutation.mutate(event.currentTarget)
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="personal-instance-name">{m.instanceName}</Label>
            <Input id="personal-instance-name" name="name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="personal-instance-url">{m.instanceUrl}</Label>
            <Input
              id="personal-instance-url"
              name="baseUrl"
              type="url"
              placeholder="https://more-token.example.com"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="personal-ca-path">{m.customCa}</Label>
            <Input id="personal-ca-path" name="customCaPath" />
            <p className="text-xs text-muted-foreground">{m.customCaHint}</p>
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" name="readOnly" />
            {m.readOnly}
          </label>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {m.cancel}
          </Button>
          <Button form="personal-instance-form" type="submit" disabled={mutation.isPending}>
            {m.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
