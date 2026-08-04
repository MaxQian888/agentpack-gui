"use client"

import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  Check,
  ExternalLink,
  KeyRound,
  Plus,
  RefreshCw,
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
  credentialState,
  forgetCredential,
  listInstances,
  loginPersonalInstance,
  managementRequest,
  ManagementApiError,
  operationId,
  pairInstance,
  saveInstance,
} from "@/lib/more-token/client"
import type {
  CredentialState,
  MoreTokenInstance,
  Page,
  PersonalAccount,
  PersonalCapabilities,
  PersonalLedgerEntry,
  PersonalOverview,
  PersonalSession,
  PersonalUsage,
  PersonalView,
} from "@/lib/more-token/types"
import { DesktopOnlyNote } from "../../desktop-only-note"
import { SectionShell } from "../section-shell"

const PERSONAL_CLIENT_ID = "agentpack-personal-desktop"

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
  const [mode, setMode] = useState<"password" | "pairing">("password")
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false)
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
  return (
    <div className="mx-auto max-w-xl space-y-4 border-y py-8">
      <div>
        <h3 className="flex items-center gap-2 font-medium">
          <KeyRound className="size-4" />
          {mode === "password" ? personal.signInTitle : m.pairTitle}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "password" ? personal.signInHint : m.pairHint}
        </p>
      </div>
      <div className="grid grid-cols-2 rounded-md border p-1">
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
      {mode === "password" ? (
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
      <div className="border-t pt-4">
        <Button
          type="button"
          variant="link"
          className="h-auto min-h-11 whitespace-normal px-0 text-left"
          onClick={() =>
            void openUrl(new URL("/api/personal/browser-login", instance.baseUrl).toString())
          }
        >
          <ExternalLink className="size-4" />
          {personal.otherLoginMethods}
        </Button>
        <p className="text-xs text-muted-foreground">{personal.otherLoginHint}</p>
      </div>
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

function MetricStrip({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <dl className="grid overflow-hidden rounded-md border sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item, index) => (
        <div
          key={item.label}
          className={`min-w-0 p-4 ${index ? "border-t sm:border-l sm:border-t-0" : ""}`}
        >
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 truncate text-xl font-semibold tabular-nums">{item.value}</dd>
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
  return (
    <div className="space-y-5">
      <MetricStrip
        items={[
          { label: m.available, value: formatNumber(info.balance.available) },
          { label: m.used, value: formatNumber(info.balance.used) },
          { label: m.total, value: formatNumber(info.balance.total) },
          { label: m.requests, value: formatNumber(info.account.request_count) },
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
    queryFn: () =>
      request<{ available: number; used: number; total: number; request_count: number }>(
        instance.id,
        { kind: "personalBalance" }
      ),
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
            { label: m.available, value: formatNumber(balance.data.available) },
            { label: m.used, value: formatNumber(balance.data.used) },
            { label: m.total, value: formatNumber(balance.data.total) },
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
                    {formatNumber(entry.delta)}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {formatNumber(entry.balance_after)}
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
  const usage = useQuery({
    queryKey: ["more-token", instance.id, "personal-usage", days],
    queryFn: () =>
      request<PersonalUsage>(instance.id, {
        kind: "personalUsage",
        start: now - days * 86400,
        end: now,
      }),
  })
  if (usage.isError) return <PersonalError error={usage.error} retry={() => void usage.refetch()} />
  if (!usage.data) return <PersonalLoading />
  const max = Math.max(1, ...usage.data.series.map((point) => point.quota))
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{m.usageDefinition}</p>
        <select
          aria-label="Usage range"
          value={days}
          onChange={(event) => setDays(Number(event.target.value))}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
      </div>
      <MetricStrip
        items={[
          { label: m.requests, value: formatNumber(usage.data.metrics.requests) },
          { label: m.promptTokens, value: formatNumber(usage.data.metrics.prompt_tokens) },
          { label: m.completionTokens, value: formatNumber(usage.data.metrics.completion_tokens) },
          { label: m.used, value: formatNumber(usage.data.metrics.quota) },
        ]}
      />
      <section className="border-y py-5">
        <div className="flex h-52 items-end gap-1" aria-label={m.usageDefinition}>
          {usage.data.series.map((point) => (
            <div
              key={point.bucket}
              className="min-w-1 flex-1 bg-primary/75"
              style={{ height: `${Math.max(2, (point.quota / max) * 100)}%` }}
              title={`${formatTime(point.bucket)} · ${formatNumber(point.quota)}`}
            />
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {m.generatedAt}: {formatTime(usage.data.generated_at)}
        </p>
      </section>
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
