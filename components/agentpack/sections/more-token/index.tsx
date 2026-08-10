/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 */
/* Hallmark · genre: modern-minimal · macrostructure: Workbench · design-system: design.md · designed-as-app */
"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  ArrowLeftRight,
  Bell,
  Check,
  ChevronRight,
  Download,
  Ellipsis,
  KeyRound,
  ListTree,
  Network,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  Unplug,
} from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { DesktopOnlyNote } from "../../desktop-only-note"
import { CapabilityMetric, CapabilityTile, CapabilityWorkbench } from "../capability-workbench"
import { AccountDetailSheet } from "./account-detail-sheet"
import { isTauri } from "@/lib/tauri"
import { hasInjectedMoreTokenPort } from "@/lib/more-token/port"
import { useT } from "@/lib/i18n/provider"
import { notify } from "@/lib/tauri/system"
import {
  credentialState,
  downloadCsv,
  forgetCredential,
  listInstances,
  managementRequest,
  ManagementApiError,
  operationId,
  pairInstance,
  removeInstance,
  saveInstance,
} from "@/lib/more-token/client"
import { authorizeManagementPreview } from "@/lib/more-token/step-up"
import { availableAccountActions } from "@/lib/more-token/accounts"
import { quotaAmountWithRaw, quotaTransactionsCsvRows } from "@/lib/more-token/quota"
import type {
  Account,
  AccountAction,
  AccountActionBody,
  AccountBatchBody,
  AccountDetail,
  AlertRuleBody,
  AlertEvent,
  AlertRule,
  AnalyticsData,
  AuditEvent,
  ManagementCapabilities,
  ManagementOperation,
  ManagementView,
  MoreTokenInstance,
  OverviewData,
  Page,
  QuotaPolicy,
  QuotaDisplaySetting,
  QuotaBatchBody,
  QuotaTransferBody,
  UpdateQuotaPolicyBody,
  QuotaSummary,
  QuotaTransaction,
} from "@/lib/more-token/types"
import type { UsageSeriesResult } from "@/lib/history/types"
import { EV } from "@/lib/history/types"

const CLIENT_ID = "agentpack-desktop"

function data<T>(instanceId: string, operation: ManagementOperation, signal?: AbortSignal) {
  return managementRequest<T>(instanceId, operation, signal).then((response) => response.data)
}

function errorText(error: unknown): string {
  if (error instanceof ManagementApiError) return `${error.code}: ${error.message}`
  return error instanceof Error ? error.message : String(error)
}

async function forgetCredentialRemoteFirst(instanceId: string, localOnlyWarning: string) {
  try {
    return await forgetCredential(instanceId)
  } catch (error) {
    const confirmed = window.confirm(`${errorText(error)}\n\n${localOnlyWarning}`)
    if (!confirmed) throw error
    return forgetCredential(instanceId, true)
  }
}

function formatTime(value: number): string {
  if (!value) return "—"
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value * 1000))
}

function number(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function PageControls({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
}) {
  const m = useT().management
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
      <span>
        {number(total)} · {page}/{pages}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label={m.previousPage}
        >
          {m.previousPage}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label={m.nextPage}
        >
          {m.nextPage}
        </Button>
      </div>
    </div>
  )
}

export interface MoreTokenSectionProps {
  view: ManagementView
  localUsage: {
    data: UsageSeriesResult | null
    loading: boolean
    request: () => void
  }
}

export function MoreTokenSection({ view, localUsage }: MoreTokenSectionProps) {
  const m = useT().management
  const queryClient = useQueryClient()
  const tauri = isTauri() || hasInjectedMoreTokenPort()
  const instancesQuery = useQuery({
    queryKey: ["more-token", "instances"],
    queryFn: listInstances,
    enabled: tauri,
    staleTime: Infinity,
  })
  const [selectedId, setSelectedId] = useState("")
  const [instanceOpen, setInstanceOpen] = useState(false)
  // Legacy records predate the package discriminator and remain management
  // connections. Explicit personal records never enter this surface.
  const instances = (instancesQuery.data ?? []).filter((item) => item.package !== "personal")
  const activeId = selectedId || instances[0]?.id || ""
  const instance = instances.find((item) => item.id === activeId) ?? null
  const credentialQuery = useQuery({
    queryKey: ["more-token", activeId, "credential"],
    queryFn: () => credentialState(activeId),
    enabled: tauri && activeId !== "",
    staleTime: Infinity,
  })
  const capabilities = useQuery({
    queryKey: ["more-token", activeId, "capabilities"],
    queryFn: ({ signal }) =>
      data<ManagementCapabilities>(activeId, { kind: "capabilities" }, signal),
    enabled: credentialQuery.data?.connected === true,
  })
  const notificationQuery = useQuery({
    queryKey: ["more-token", activeId, "notifications"],
    queryFn: ({ signal }) =>
      data<Array<{ id: number; payload: string }>>(activeId, { kind: "notifications" }, signal),
    enabled: credentialQuery.data?.connected === true,
    refetchInterval: 30_000,
  })
  const delivered = useRef(new Set<number>())

  useEffect(() => {
    const items = notificationQuery.data ?? []
    for (const item of items) {
      if (delivered.current.has(item.id)) continue
      delivered.current.add(item.id)
      let message = m.pendingAlerts
      try {
        const parsed = JSON.parse(item.payload) as { message?: string }
        message = parsed.message ?? message
      } catch {}
      void notify(m.title, message)
      void managementRequest(activeId, { kind: "acknowledgeNotification", id: item.id })
    }
  }, [activeId, m.pendingAlerts, m.title, notificationQuery.data])

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["more-token", activeId] })
  }

  if (!tauri) {
    return (
      <CapabilityWorkbench
        title={m.title}
        subtitle={m.subtitle}
        summaryLabel={m.statusSummary}
        actionsLabel={m.supportingActions}
        primary={<DesktopOnlyNote>{m.desktopOnly}</DesktopOnlyNote>}
      />
    )
  }

  const actions = (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setInstanceOpen(true)}>
        <Plus className="size-4" />
        <span className="hidden sm:inline">{m.addInstance}</span>
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={refresh}
        disabled={!activeId}
        aria-label={m.retry}
      >
        <RefreshCw className="size-4" />
      </Button>
    </div>
  )

  const title = m.tabs[view === "management-overview" ? "overview" : view]
  const connected = credentialQuery.data?.connected === true
  const connectionLabel = credentialQuery.isLoading
    ? m.loading
    : credentialQuery.isError
      ? m.unavailable
      : connected
        ? m.healthy
        : m.unavailable
  const primary = instancesQuery.isError ? (
    <ErrorPanel error={instancesQuery.error} retry={() => void instancesQuery.refetch()} />
  ) : instancesQuery.isLoading ? (
    <LoadingPanel />
  ) : instances.length === 0 ? (
    <EmptyPanel
      text={m.noInstances}
      action={<Button onClick={() => setInstanceOpen(true)}>{m.addInstance}</Button>}
    />
  ) : credentialQuery.isError ? (
    <ErrorPanel error={credentialQuery.error} retry={() => void credentialQuery.refetch()} />
  ) : credentialQuery.isLoading ? (
    <LoadingPanel />
  ) : credentialQuery.data?.connected !== true ? (
    <PairPanel instance={instance!} onPaired={() => void credentialQuery.refetch()} />
  ) : capabilities.isError ? (
    <ErrorPanel error={capabilities.error} retry={() => void capabilities.refetch()} />
  ) : capabilities.data ? (
    <div className="space-y-5">
      {instance?.readOnly ? (
        <Alert>
          <ShieldAlert className="size-4" />
          <AlertTitle>{m.readOnly}</AlertTitle>
          <AlertDescription>{m.readonlyBanner}</AlertDescription>
        </Alert>
      ) : null}
      {view === "management-overview" ? (
        <OverviewView instances={instances} activeId={activeId} />
      ) : view === "accounts" ? (
        <AccountsView instance={instance!} capabilities={capabilities.data} />
      ) : view === "quota" ? (
        <QuotaView instance={instance!} capabilities={capabilities.data} />
      ) : view === "analytics" ? (
        <AnalyticsView instance={instance!} localUsage={localUsage} />
      ) : (
        <AuditView instance={instance!} capabilities={capabilities.data} />
      )}
    </div>
  ) : (
    <LoadingPanel />
  )

  return (
    <CapabilityWorkbench
      title={title}
      subtitle={m.subtitle}
      actions={actions}
      summaryLabel={m.statusSummary}
      actionsLabel={m.supportingActions}
      metrics={
        <>
          <CapabilityMetric
            label={m.instances}
            value={
              instancesQuery.isLoading || instancesQuery.isError ? "—" : number(instances.length)
            }
            detail={
              instancesQuery.isLoading
                ? m.loading
                : instancesQuery.isError
                  ? errorText(instancesQuery.error)
                  : undefined
            }
          />
          <CapabilityMetric
            label={m.health}
            value={
              instancesQuery.isLoading || credentialQuery.isLoading || credentialQuery.isError
                ? "—"
                : connected
                  ? m.healthy
                  : m.unavailable
            }
            detail={
              credentialQuery.isLoading
                ? m.loading
                : credentialQuery.isError
                  ? errorText(credentialQuery.error)
                  : undefined
            }
          />
          <CapabilityMetric
            label={m.apiVersion}
            value={capabilities.data?.management_api_version ?? "—"}
            detail={capabilities.isLoading ? m.loading : undefined}
          />
          <CapabilityMetric label={m.role} value={capabilities.data?.role ?? "—"} />
        </>
      }
      primary={primary}
      aside={
        <>
          <CapabilityTile
            title={m.connection}
            description={m.connectionHint}
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
                  <Label htmlFor="more-token-instance">{m.instance}</Label>
                  <select
                    id="more-token-instance"
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
                    ? credentialQuery.data?.persistent
                      ? m.persistentCredential
                      : m.memoryCredential
                    : m.pairTitle}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setInstanceOpen(true)}>
                    {m.editInstance}
                  </Button>
                  {connected ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        try {
                          await forgetCredentialRemoteFirst(activeId, m.localOnlyCredentialWarning)
                          await credentialQuery.refetch()
                        } catch (error) {
                          toast.error(errorText(error))
                        }
                      }}
                    >
                      <Unplug className="size-4" />
                      {m.disconnect}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setInstanceOpen(true)}>
                <Plus className="size-4" />
                {m.addInstance}
              </Button>
            )}
          </CapabilityTile>
          <CapabilityTile title={m.workspace} description={m.workspaceHint}>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
              <dt className="text-muted-foreground">{m.workspace}</dt>
              <dd className="min-w-0 text-right font-medium [overflow-wrap:anywhere]">{title}</dd>
              <dt className="text-muted-foreground">{m.grantedScopes}</dt>
              <dd className="text-right font-mono tabular-nums">
                {capabilities.data ? number(capabilities.data.scopes.length) : "—"}
              </dd>
            </dl>
          </CapabilityTile>
        </>
      }
      detail={
        <InstanceDialog
          open={instanceOpen}
          instance={instance}
          onOpenChange={setInstanceOpen}
          onSaved={async (saved) => {
            await queryClient.invalidateQueries({ queryKey: ["more-token", "instances"] })
            setSelectedId(saved.id)
          }}
          onRemoved={async () => {
            setSelectedId("")
            await queryClient.invalidateQueries({ queryKey: ["more-token"] })
          }}
        />
      }
    />
  )
}

function LoadingPanel() {
  return (
    <div className="grid gap-3 sm:grid-cols-3" aria-busy="true">
      <Skeleton className="h-28" />
      <Skeleton className="h-28" />
      <Skeleton className="h-28" />
    </div>
  )
}

function EmptyPanel({ text, action }: { text: string; action?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
        <Network className="size-6" />
        <p>{text}</p>
        {action}
      </CardContent>
    </Card>
  )
}

function ErrorPanel({ error, retry }: { error: unknown; retry: () => void }) {
  const m = useT().management
  return (
    <Alert variant="destructive">
      <AlertTriangle className="size-4" />
      <AlertTitle>{m.unavailable}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>{errorText(error)}</span>
        <Button variant="outline" size="sm" onClick={retry}>
          {m.retry}
        </Button>
      </AlertDescription>
    </Alert>
  )
}

function PairPanel({ instance, onPaired }: { instance: MoreTokenInstance; onPaired: () => void }) {
  const m = useT().management
  const codeRef = useRef<HTMLInputElement>(null)
  const mutation = useMutation({
    mutationFn: () => pairInstance(instance.id, codeRef.current?.value ?? "", CLIENT_ID),
    onSuccess: (result) => {
      toast.success(result.credentialPersistent ? m.persistentCredential : m.memoryCredential)
      if (codeRef.current) codeRef.current.value = ""
      onPaired()
    },
    onError: (error) => toast.error(errorText(error)),
  })
  return (
    <Card className="mx-auto w-full max-w-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4" />
          {m.pairTitle}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{m.pairHint}</p>
        <div className="space-y-2">
          <Label htmlFor="pair-code">{m.pairingCode}</Label>
          <Input
            ref={codeRef}
            id="pair-code"
            autoComplete="one-time-code"
            placeholder="ABCDE-FGHIJ"
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
      </CardContent>
    </Card>
  )
}

function OverviewView({
  instances,
  activeId,
}: {
  instances: MoreTokenInstance[]
  activeId: string
}) {
  const m = useT().management
  const overviewQueries = useQueries({
    queries: instances.map((instance) => ({
      queryKey: ["more-token", instance.id, "overview"],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        data<OverviewData>(instance.id, { kind: "overview" }, signal),
      retry: 1,
    })),
  })
  const accounts = useQuery({
    queryKey: ["more-token", activeId, "accounts", "topology"],
    queryFn: ({ signal }) =>
      data<Page<Account>>(activeId, { kind: "accounts", page: 1, pageSize: 200 }, signal),
  })
  const alerts = useQuery({
    queryKey: ["more-token", activeId, "alert-events", "open"],
    queryFn: ({ signal }) =>
      data<Page<AlertEvent>>(
        activeId,
        { kind: "alertEvents", page: 1, pageSize: 10, acknowledged: false },
        signal
      ),
  })
  const failed = overviewQueries.filter((query) => query.isError).length
  return (
    <div className="space-y-5">
      {failed > 0 ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>{m.partial}</AlertTitle>
          <AlertDescription>
            {failed} / {instances.length} {m.unavailable.toLowerCase()}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="overflow-hidden rounded-md border divide-y">
        {overviewQueries.map((query, index) => {
          const item = instances[index]
          return (
            <div
              key={item.id}
              className="grid gap-3 p-4 lg:grid-cols-[minmax(160px,0.8fr)_repeat(3,minmax(100px,0.55fr))] lg:items-center"
            >
              <div className="flex min-w-0 items-center justify-between gap-3 lg:justify-start">
                <span className="truncate text-sm font-medium">{item.name}</span>
                <Badge variant={query.isError ? "destructive" : "outline"}>
                  {query.isError ? m.unavailable : m.healthy}
                </Badge>
              </div>
              {query.data ? (
                <>
                  <Metric label={m.accounts} value={number(query.data.summary.accounts)} />
                  <Metric label={m.totalQuota} value={number(query.data.summary.total_quota)} />
                  <Metric label={m.openAlerts} value={number(query.data.open_alerts)} />
                </>
              ) : (
                <Skeleton className="h-12 lg:col-span-3" />
              )}
            </div>
          )
        })}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]">
        <section className="border-y py-5">
          <div>
            <h3 className="flex items-center gap-2 font-medium">
              <ListTree className="size-4" />
              {m.topology}
            </h3>
            <p className="text-xs text-muted-foreground">{m.topologyHint}</p>
          </div>
          <div className="mt-4">
            {accounts.isLoading ? (
              <Skeleton className="h-52" />
            ) : (
              <Topology accounts={accounts.data?.items ?? []} />
            )}
          </div>
        </section>
        <div className="divide-y border-y">
          <section className="py-5">
            <h3 className="font-medium">{m.balanceRisk}</h3>
            <div className="mt-4">
              <RiskDistribution accounts={accounts.data?.items ?? []} />
            </div>
          </section>
          <section className="py-5">
            <h3 className="flex items-center gap-2 font-medium">
              <Bell className="size-4" />
              {m.pendingAlerts}
            </h3>
            <div className="mt-4 space-y-2">
              {alerts.data?.items.length ? (
                alerts.data.items.map((event) => (
                  <div key={event.id} className="border-l-2 border-[var(--hm-warn)] pl-3 text-sm">
                    <p className="font-medium">{event.message}</p>
                    <p className="text-xs text-muted-foreground">{formatTime(event.created_at)}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">{m.noData}</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function Topology({ accounts }: { accounts: Account[] }) {
  const masters = accounts.filter((account) => account.is_master)
  if (!masters.length) return <p className="text-sm text-muted-foreground">—</p>
  return (
    <ScrollArea className="h-64">
      <div className="space-y-4 pr-3">
        {masters.map((master) => {
          const children = accounts.filter((account) => account.master_id === master.id)
          return (
            <div
              key={master.id}
              className="grid grid-cols-[minmax(120px,0.4fr)_18px_minmax(0,1fr)] items-start gap-2"
            >
              <div className="rounded-md border-l-2 border-[var(--hm-accent)] bg-muted/40 p-2">
                <p className="truncate text-sm font-medium">{master.username}</p>
                <p className="text-xs tabular-nums text-muted-foreground">{number(master.quota)}</p>
              </div>
              <ChevronRight className="mt-3 size-4 text-muted-foreground" />
              <div className="flex flex-wrap gap-2">
                {children.length ? (
                  children.slice(0, 12).map((child) => (
                    <span key={child.id} className="rounded-md border px-2 py-1 text-xs">
                      <span className="font-medium">{child.username}</span>{" "}
                      <span className="tabular-nums text-muted-foreground">
                        {number(child.quota)}
                      </span>
                    </span>
                  ))
                ) : (
                  <span className="py-2 text-xs text-muted-foreground">—</span>
                )}
                {children.length > 12 ? (
                  <Badge variant="secondary">+{children.length - 12}</Badge>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

function RiskDistribution({ accounts }: { accounts: Account[] }) {
  const total = accounts.length || 1
  const exhausted = accounts.filter((account) => account.quota <= 0).length
  const low = accounts.filter((account) => account.quota > 0 && account.quota < 100_000).length
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex justify-between text-xs">
          <span>0</span>
          <span>{exhausted}</span>
        </div>
        <Progress value={(exhausted / total) * 100} />
      </div>
      <div>
        <div className="mb-1 flex justify-between text-xs">
          <span>&lt; 100k</span>
          <span>{low}</span>
        </div>
        <Progress value={(low / total) * 100} />
      </div>
    </div>
  )
}

function AccountsView({
  instance,
  capabilities,
}: {
  instance: MoreTokenInstance
  capabilities: ManagementCapabilities
}) {
  const m = useT().management
  const queryClient = useQueryClient()
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [lifecycle, setLifecycle] = useState("")
  const [accessStatus, setAccessStatus] = useState<"" | "enabled" | "disabled">("")
  const [relation, setRelation] = useState<"" | "master" | "child">("")
  const [roleFilter, setRoleFilter] = useState<"" | "root" | "admin" | "master" | "child">("")
  const [sortBy, setSortBy] = useState<"created_at" | "username" | "quota" | "last_login_at">(
    "created_at"
  )
  const [page, setPage] = useState(1)
  const pageSize = 25
  const [tree, setTree] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [action, setAction] = useState<{
    account: Account
    action: AccountAction | "close"
  } | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])
  const accounts = useQuery({
    queryKey: [
      "more-token",
      instance.id,
      "accounts",
      page,
      search,
      lifecycle,
      accessStatus,
      relation,
      roleFilter,
      sortBy,
    ],
    queryFn: ({ signal }) =>
      data<Page<Account>>(
        instance.id,
        {
          kind: "accounts",
          page,
          pageSize,
          search: search || null,
          lifecycleState: lifecycle || null,
          accessStatus: accessStatus || null,
          relation: relation || null,
          role: roleFilter || null,
          sortBy,
          sortOrder: "desc",
        },
        signal
      ),
    placeholderData: (previous) => previous,
  })
  const detailQuery = useQuery({
    queryKey: ["more-token", instance.id, "account", detailId],
    queryFn: () =>
      data<{ account: AccountDetail }>(instance.id, { kind: "account", id: detailId! }),
    enabled: detailId !== null,
  })
  const canWrite = !instance.readOnly && capabilities.scopes.includes("accounts:write")
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["more-token", instance.id] })
  const bulk = async (nextAction: "enable" | "disable" | "archive") => {
    try {
      const accountIds = [...selected].sort((left, right) => left - right)
      const draft = {
        batch_operation_id: operationId(),
        mode: "best_effort" as const,
        action: nextAction,
        account_ids: accountIds,
        reason: `bulk ${nextAction}`,
      }
      const preview = await data<{ preview_token: string }>(instance.id, {
        kind: "actionPreview",
        body: { action: "account_batch", payload: draft },
      })
      await authorizeManagementPreview(instance.id, preview.preview_token)
      const body: AccountBatchBody = { ...draft, preview_token: preview.preview_token }
      const result = await data<{ succeeded: number; failed: number }>(instance.id, {
        kind: "createAccountBatch",
        body,
      })
      toast.success(`${result.succeeded} succeeded · ${result.failed} failed`)
      setSelected(new Set())
      await invalidate()
    } catch (error) {
      toast.error(errorText(error))
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={m.searchAccounts}
              className="pl-8"
            />
          </div>
          <select
            value={lifecycle}
            onChange={(event) => {
              setLifecycle(event.target.value)
              setPage(1)
            }}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="">{m.allStates}</option>
            <option value="active">{m.active}</option>
            <option value="closing">{m.closing}</option>
            <option value="archived">{m.archived}</option>
          </select>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setTree((value) => !value)}>
            <ListTree className="size-4" />
            {tree ? m.tableView : m.treeView}
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)} disabled={!canWrite}>
            <Plus className="size-4" />
            {m.createAccount}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <select
          aria-label={m.accessStatus}
          value={accessStatus}
          onChange={(event) => {
            setAccessStatus(event.target.value as typeof accessStatus)
            setPage(1)
          }}
          className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">{m.allAccessStates}</option>
          <option value="enabled">{m.enabled}</option>
          <option value="disabled">{m.disabled}</option>
        </select>
        <select
          aria-label={m.relationship}
          value={relation}
          onChange={(event) => {
            setRelation(event.target.value as typeof relation)
            setPage(1)
          }}
          className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">{m.allRelationships}</option>
          <option value="master">{m.master}</option>
          <option value="child">{m.child}</option>
        </select>
        <select
          aria-label={m.role}
          value={roleFilter}
          onChange={(event) => {
            setRoleFilter(event.target.value as typeof roleFilter)
            setPage(1)
          }}
          className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">{m.allRoles}</option>
          <option value="root">Root</option>
          <option value="admin">Admin</option>
          <option value="master">{m.master}</option>
          <option value="child">{m.child}</option>
        </select>
        <select
          aria-label={m.sortAccounts}
          value={sortBy}
          onChange={(event) => {
            setSortBy(event.target.value as typeof sortBy)
            setPage(1)
          }}
          className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm"
        >
          <option value="created_at">{m.newest}</option>
          <option value="username">{m.username}</option>
          <option value="quota">{m.balance}</option>
          <option value="last_login_at">{m.lastLogin}</option>
        </select>
      </div>
      {selected.size ? (
        <div className="flex flex-wrap items-center gap-2 border-y py-2">
          <span className="text-sm font-medium">{m.selected(selected.size)}</span>
          <Button variant="outline" size="sm" onClick={() => void bulk("enable")}>
            {m.batchEnable}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void bulk("disable")}>
            {m.batchDisable}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void bulk("archive")}>
            {m.batchArchive}
          </Button>
        </div>
      ) : null}
      {accounts.isLoading ? (
        <LoadingPanel />
      ) : tree ? (
        <Topology accounts={accounts.data?.items ?? []} />
      ) : (
        <AccountTable
          accounts={accounts.data?.items ?? []}
          selected={selected}
          setSelected={setSelected}
          onDetail={(account) => setDetailId(account.id)}
          onAction={(account, nextAction) => setAction({ account, action: nextAction })}
          capabilities={capabilities}
          readOnly={instance.readOnly}
          quotaDisplay={capabilities.quota_display}
        />
      )}
      <div className="flex items-center justify-between border-t pt-3 text-sm">
        <span className="text-muted-foreground">
          {accounts.data?.total ?? 0} accounts · page {page}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}
          >
            {m.previousPage}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page * pageSize >= (accounts.data?.total ?? 0)}
            onClick={() => setPage((value) => value + 1)}
          >
            {m.nextPage}
          </Button>
        </div>
      </div>
      <CreateAccountDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        instance={instance}
        capabilities={capabilities}
        onDone={invalidate}
      />
      <AccountActionDialog
        state={action}
        onOpenChange={(open) => !open && setAction(null)}
        instance={instance}
        managementRole={capabilities.role}
        onDone={invalidate}
      />
      <AccountDetailSheet
        key={detailId ?? "closed"}
        account={detailQuery.data?.account ?? null}
        quotaDisplay={capabilities.quota_display}
        instance={instance}
        capabilities={capabilities}
        onDone={invalidate}
        onOpenChange={(open) => !open && setDetailId(null)}
      />
    </div>
  )
}

function AccountTable({
  accounts,
  selected,
  setSelected,
  onDetail,
  onAction,
  capabilities,
  readOnly,
  quotaDisplay,
}: {
  accounts: Account[]
  selected: Set<number>
  setSelected: (value: Set<number>) => void
  onDetail: (account: Account) => void
  onAction: (account: Account, action: AccountAction | "close") => void
  capabilities: ManagementCapabilities
  readOnly: boolean
  quotaDisplay: QuotaDisplaySetting
}) {
  const m = useT().management
  return (
    <>
      <div className="space-y-2 sm:hidden">
        {accounts.map((account) => (
          <article key={account.id} className="rounded-lg border bg-card p-3 shadow-sm">
            <div className="flex items-start gap-3">
              <Checkbox
                aria-label={account.username}
                checked={selected.has(account.id)}
                onCheckedChange={(value) => {
                  const next = new Set(selected)
                  if (value) next.add(account.id)
                  else next.delete(account.id)
                  setSelected(next)
                }}
              />
              <button className="min-w-0 flex-1 text-left" onClick={() => onDetail(account)}>
                <span className="block truncate font-medium">{account.username}</span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">
                  {account.display_name || `#${account.id}`} ·{" "}
                  {account.master_id ? `child of #${account.master_id}` : "master"}
                </span>
                <span className="mt-2 block text-sm font-semibold tabular-nums">
                  {quotaAmountWithRaw(account.quota, quotaDisplay)}
                </span>
              </button>
              <AccountActionsMenu
                account={account}
                capabilities={capabilities}
                readOnly={readOnly}
                onAction={onAction}
              />
            </div>
            <div className="mt-3 flex gap-2">
              <Badge variant="outline">{account.status === 1 ? "enabled" : "disabled"}</Badge>
              <Badge
                variant={
                  account.lifecycle_state === "active" || !account.lifecycle_state
                    ? "outline"
                    : "secondary"
                }
              >
                {account.lifecycle_state || "active"}
              </Badge>
            </div>
          </article>
        ))}
      </div>
      <div className="hidden overflow-x-auto rounded-md border sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  aria-label={m.all}
                  checked={accounts.length > 0 && selected.size === accounts.length}
                  onCheckedChange={(value) =>
                    setSelected(value ? new Set(accounts.map((account) => account.id)) : new Set())
                  }
                />
              </TableHead>
              <TableHead>{m.username}</TableHead>
              <TableHead>{m.role}</TableHead>
              <TableHead>{m.relationship}</TableHead>
              <TableHead className="text-right">{m.balance}</TableHead>
              <TableHead>{m.lifecycle}</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">{m.actions}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((account) => (
              <TableRow key={account.id}>
                <TableCell>
                  <Checkbox
                    aria-label={account.username}
                    checked={selected.has(account.id)}
                    onCheckedChange={(value) => {
                      const next = new Set(selected)
                      if (value) next.add(account.id)
                      else next.delete(account.id)
                      setSelected(next)
                    }}
                  />
                </TableCell>
                <TableCell>
                  <button className="text-left hover:underline" onClick={() => onDetail(account)}>
                    <span className="block font-medium">{account.username}</span>
                    <span className="text-xs text-muted-foreground">
                      {account.display_name || `#${account.id}`}
                    </span>
                  </button>
                </TableCell>
                <TableCell>
                  {account.is_master ? "master" : account.role >= 10 ? "admin" : "user"}
                </TableCell>
                <TableCell>{account.master_id ? `#${account.master_id}` : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {quotaAmountWithRaw(account.quota, quotaDisplay)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      account.lifecycle_state === "active" || !account.lifecycle_state
                        ? "outline"
                        : "secondary"
                    }
                  >
                    {account.lifecycle_state || "active"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <AccountActionsMenu
                    account={account}
                    capabilities={capabilities}
                    readOnly={readOnly}
                    onAction={onAction}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}

function AccountActionsMenu({
  account,
  capabilities,
  readOnly,
  onAction,
}: {
  account: Account
  capabilities: ManagementCapabilities
  readOnly: boolean
  onAction: (account: Account, action: AccountAction | "close") => void
}) {
  const m = useT().management
  const actions = availableAccountActions(account, capabilities, readOnly)
  if (!actions.length) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`${m.actions}: ${account.username}`}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action}
            className={action === "close" ? "text-destructive" : undefined}
            onClick={() => onAction(account, action)}
          >
            {m[action === "password" ? "changePassword" : action]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CreateAccountDialog({
  open,
  onOpenChange,
  instance,
  capabilities,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  instance: MoreTokenInstance
  capabilities: ManagementCapabilities
  onDone: () => void
}) {
  const m = useT().management
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: async (
      payload: Omit<import("@/lib/more-token/types").CreateAccountBody, "preview_token">
    ) => {
      const preview = await data<{ preview_token: string }>(instance.id, {
        kind: "actionPreview",
        body: { action: "create_account", payload },
      })
      await authorizeManagementPreview(instance.id, preview.preview_token)
      return data<{ temporary_password?: string; credential_mode: string }>(instance.id, {
        kind: "createAccount",
        body: { ...payload, preview_token: preview.preview_token },
      })
    },
    onSuccess: (result) => {
      onDone()
      if (result.temporary_password) setTemporaryPassword(result.temporary_password)
      else onOpenChange(false)
    },
    onError: (error) => toast.error(errorText(error)),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            mutation.mutate({
              username: String(form.get("username") ?? ""),
              display_name: String(form.get("display_name") ?? ""),
              email: String(form.get("email") ?? ""),
              group: String(form.get("group") ?? "default"),
              master_id: Number(form.get("master_id") || 0),
              initial_quota: Number(form.get("initial_quota") || 0),
              invite_by_email:
                capabilities.features.account_invites_enabled &&
                form.get("invite_by_email") === "on",
              operation_id: operationId(),
              reason: String(form.get("reason") ?? ""),
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>{m.createAccount}</DialogTitle>
            <DialogDescription>{m.topologyHint}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {temporaryPassword ? (
              <Alert>
                <KeyRound className="size-4" />
                <AlertTitle>{m.temporaryPasswordOnce}</AlertTitle>
                <AlertDescription className="mt-2 font-mono select-all">
                  {temporaryPassword}
                </AlertDescription>
              </Alert>
            ) : null}
            <Field name="username" label={m.username} required />
            <Field name="display_name" label={m.displayName} />
            <Field name="email" label={m.email} type="email" />
            <Field name="group" label={m.group} defaultValue="default" required />
            <Field name="master_id" label={m.masterId} type="number" min={0} />
            <Field name="initial_quota" label={m.initialQuota} type="number" min={0} />
            <Field name="reason" label={m.reason} required />
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <Checkbox
                name="invite_by_email"
                disabled={!capabilities.features.account_invites_enabled}
              />
              {m.sendInvitationEmail}
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {m.cancel}
            </Button>
            <Button
              type={temporaryPassword ? "button" : "submit"}
              disabled={mutation.isPending}
              onClick={temporaryPassword ? () => onOpenChange(false) : undefined}
            >
              {temporaryPassword ? m.confirm : m.createAccount}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AccountActionDialog({
  state,
  onOpenChange,
  instance,
  managementRole,
  onDone,
}: {
  state: { account: Account; action: AccountAction | "close" } | null
  onOpenChange: (open: boolean) => void
  instance: MoreTokenInstance
  managementRole: ManagementCapabilities["role"]
  onDone: () => void
}) {
  const m = useT().management
  const [preview, setPreview] = useState<{
    preview_token: string
    impact: Array<{ id: number; quota: number; quota_version: number }>
  } | null>(null)
  const [previewPayload, setPreviewPayload] = useState<
    (Omit<AccountActionBody, "preview_token"> & { account_id: number }) | null
  >(null)
  const formRef = useRef<HTMLFormElement>(null)
  const previewMutation = useMutation({
    mutationFn: async (
      payload: Omit<AccountActionBody, "preview_token"> & { account_id: number }
    ) =>
      data<typeof preview extends null ? never : NonNullable<typeof preview>>(instance.id, {
        kind: "actionPreview",
        body: { action: state?.action ?? "", payload },
      }),
    onSuccess: setPreview,
    onError: (error) => toast.error(errorText(error)),
  })
  const commitMutation = useMutation({
    mutationFn: async ({
      payload,
      token,
    }: {
      payload: Omit<AccountActionBody, "preview_token"> & { account_id: number }
      token: string
    }) => {
      await authorizeManagementPreview(instance.id, token)
      const body: AccountActionBody = {
        preview_token: token,
        operation_id: payload.operation_id,
        reason: payload.reason,
        master_id: payload.master_id,
        balance_target_id: payload.balance_target_id,
        write_off: payload.write_off,
        password: payload.password,
      }
      return data(
        instance.id,
        state?.action === "close"
          ? {
              kind: "closeAccount",
              id: state.account.id,
              body,
            }
          : {
              kind: "accountAction",
              id: state!.account.id,
              action: state!.action,
              body,
            }
      )
    },
    onSuccess: () => {
      onOpenChange(false)
      onDone()
    },
    onError: (error) =>
      toast.error(
        error instanceof ManagementApiError && error.code === "VERSION_CONFLICT"
          ? m.versionConflict
          : errorText(error)
      ),
  })
  if (!state) return null
  const buildPayload = () => {
    const form = new FormData(formRef.current!)
    return {
      account_id: state.account.id,
      operation_id: operationId(),
      reason: String(form.get("reason") ?? ""),
      master_id: Number(form.get("master_id") || 0),
      balance_target_id: Number(form.get("balance_target_id") || 0),
      write_off: form.get("write_off") === "on",
      password: String(form.get("password") ?? ""),
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) {
          setPreview(null)
          setPreviewPayload(null)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <form
          ref={formRef}
          onSubmit={(event) => {
            event.preventDefault()
            const payload = buildPayload()
            if (!preview) {
              setPreviewPayload(payload)
              previewMutation.mutate(payload)
            } else
              commitMutation.mutate({
                payload: previewPayload ?? payload,
                token: preview.preview_token,
              })
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {m[state.action === "password" ? "changePassword" : state.action]}
            </DialogTitle>
            <DialogDescription>
              {state.account.username} · #{state.account.id}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Field name="reason" label={m.reason} required />
            <p className="text-xs text-muted-foreground">{m.reasonHint}</p>
            {state.action === "attach" ? (
              <Field name="master_id" label={m.masterId} type="number" min={1} required />
            ) : null}
            {state.action === "password" ? (
              <Field
                name="password"
                label={m.password}
                type="password"
                minLength={8}
                maxLength={20}
                required
              />
            ) : null}
            {state.action === "close" ? (
              <>
                <Field name="balance_target_id" label={m.balanceTarget} type="number" min={0} />
                {managementRole === "root" ? (
                  <label className="flex min-h-11 items-center gap-3 text-sm">
                    <Checkbox name="write_off" />
                    {m.writeOff}
                  </label>
                ) : null}
                <Field
                  name="confirm_name"
                  label={m.confirmAccount}
                  required
                  pattern={state.account.username}
                />
              </>
            ) : null}
            {preview ? (
              <div className="rounded-md border border-[var(--hm-warn)] p-3">
                <p className="text-sm font-medium">{m.previewImpact}</p>
                {preview.impact.map((item) => (
                  <p key={item.id} className="mt-2 text-xs tabular-nums">
                    #{item.id} · {m.balance} {number(item.quota)} · v{item.quota_version}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {m.cancel}
            </Button>
            <Button
              type="submit"
              variant={state.action === "close" ? "destructive" : "default"}
              disabled={previewMutation.isPending || commitMutation.isPending}
            >
              {preview ? m.confirm : previewMutation.isPending ? m.previewing : m.preview}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, ...props }: React.ComponentProps<typeof Input> & { label: string }) {
  const id = `field-${props.name}`
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...props} />
    </div>
  )
}

function QuotaView({
  instance,
  capabilities,
}: {
  instance: MoreTokenInstance
  capabilities: ManagementCapabilities
}) {
  const m = useT().management
  const queryClient = useQueryClient()
  const [transferOpen, setTransferOpen] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [now] = useState(() => Math.floor(Date.now() / 1000))
  const [ledgerPage, setLedgerPage] = useState(1)
  const [ledgerType, setLedgerType] = useState("")
  const summary = useQuery({
    queryKey: ["more-token", instance.id, "quota-summary"],
    queryFn: ({ signal }) => data<QuotaSummary>(instance.id, { kind: "quotaSummary" }, signal),
  })
  const ledger = useQuery({
    queryKey: ["more-token", instance.id, "ledger", ledgerPage, ledgerType],
    queryFn: ({ signal }) =>
      data<Page<QuotaTransaction>>(
        instance.id,
        {
          kind: "quotaTransactions",
          page: ledgerPage,
          pageSize: 25,
          transactionType: ledgerType || null,
        },
        signal
      ),
  })
  const policy = useQuery({
    queryKey: ["more-token", instance.id, "policy"],
    queryFn: ({ signal }) => data<QuotaPolicy>(instance.id, { kind: "quotaPolicy" }, signal),
  })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["more-token", instance.id] })
  const canTransfer =
    !instance.readOnly &&
    capabilities.features.quota_transfer_enabled &&
    capabilities.scopes.includes("quota:transfer")
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" onClick={() => setTransferOpen(true)} disabled={!canTransfer}>
          <ArrowLeftRight className="size-4" />
          {m.transfer}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setBatchOpen(true)}
          disabled={!canTransfer}
        >
          {m.batchTransfer}
        </Button>
      </div>
      {!capabilities.features.quota_transfer_enabled ? (
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertTitle>{m.featureDisabled}</AlertTitle>
        </Alert>
      ) : null}
      {capabilities.quota_display.rate_valid_until > 0 &&
      capabilities.quota_display.rate_valid_until < now ? (
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertTitle>{m.exchangeRateExpired}</AlertTitle>
          <AlertDescription>{m.exchangeRateExpiredHint}</AlertDescription>
        </Alert>
      ) : null}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-4 [&>div]:bg-background">
        <CapabilityMetric
          label={m.totalQuota}
          value={
            summary.data
              ? quotaAmountWithRaw(summary.data.available, capabilities.quota_display)
              : "—"
          }
        />
        <CapabilityMetric
          label={m.usedQuota}
          value={
            summary.data ? quotaAmountWithRaw(summary.data.used, capabilities.quota_display) : "—"
          }
        />
        <CapabilityMetric
          label={m.accounts}
          value={summary.data ? number(summary.data.accounts) : "—"}
        />
        <CapabilityMetric
          label={m.quotaTotal}
          value={
            summary.data ? quotaAmountWithRaw(summary.data.total, capabilities.quota_display) : "—"
          }
        />
      </dl>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(310px,0.75fr)]">
        <section className="min-w-0 overflow-hidden border-y">
          <div className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="font-medium">{m.ledger}</h3>
            <div className="flex flex-wrap gap-2">
              <select
                value={ledgerType}
                onChange={(event) => {
                  setLedgerType(event.target.value)
                  setLedgerPage(1)
                }}
                className="h-9 rounded-md border bg-background px-2 text-sm"
                aria-label={m.transactionType}
              >
                <option value="">{m.all}</option>
                <option value="transfer">transfer</option>
                <option value="reversal">reversal</option>
                <option value="adjustment">adjustment</option>
                <option value="initial_allocation">initial_allocation</option>
              </select>
              <Button
                variant="outline"
                size="sm"
                disabled={!ledger.data?.items.length}
                onClick={() =>
                  downloadCsv(
                    `more-token-ledger-${instance.id}-${ledgerPage}.csv`,
                    quotaTransactionsCsvRows(ledger.data?.items ?? [])
                  )
                }
              >
                <Download className="size-4" />
                {m.exportLedgerPage}
              </Button>
            </div>
          </div>
          <div className="min-w-0 overflow-x-auto">
            <LedgerTable
              items={ledger.data?.items ?? []}
              instance={instance}
              capabilities={capabilities}
              onDone={invalidate}
            />
          </div>
          <PageControls
            page={ledgerPage}
            pageSize={25}
            total={ledger.data?.total ?? 0}
            onPage={setLedgerPage}
          />
        </section>
        <PolicyEditor
          policy={policy.data ?? null}
          instance={instance}
          capabilities={capabilities}
          onDone={invalidate}
        />
      </div>
      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        instance={instance}
        capabilities={capabilities}
        onDone={invalidate}
      />
      <BatchDialog
        open={batchOpen}
        onOpenChange={setBatchOpen}
        instance={instance}
        onDone={invalidate}
      />
    </div>
  )
}

function LedgerTable({
  items,
  instance,
  capabilities,
  onDone,
}: {
  items: QuotaTransaction[]
  instance: MoreTokenInstance
  capabilities: ManagementCapabilities
  onDone: () => void
}) {
  const m = useT().management
  const reverse = useMutation({
    mutationFn: async (transaction: QuotaTransaction) => {
      const op = operationId()
      const reason = `reverse transaction ${transaction.id}`
      const payload = {
        account_id: transaction.target_id,
        source_id: transaction.target_id,
        target_id: transaction.source_id,
        transaction_id: transaction.id,
        operation_id: op,
        reason,
      }
      const preview = await data<{ preview_token: string }>(instance.id, {
        kind: "actionPreview",
        body: { action: "quota_reverse", payload },
      })
      await authorizeManagementPreview(instance.id, preview.preview_token)
      return data(instance.id, {
        kind: "reverseQuota",
        id: transaction.id,
        body: { operation_id: op, reason, preview_token: preview.preview_token },
      })
    },
    onSuccess: onDone,
    onError: (error) => toast.error(errorText(error)),
  })
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{m.transactionType}</TableHead>
            <TableHead>{m.relationship}</TableHead>
            <TableHead className="text-right">{m.amount}</TableHead>
            <TableHead>{m.reason}</TableHead>
            <TableHead>{m.status}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>{item.type}</TableCell>
              <TableCell className="font-mono text-xs">
                #{item.source_id || "—"} → #{item.target_id || "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {quotaAmountWithRaw(item.amount, capabilities.quota_display)}
              </TableCell>
              <TableCell className="max-w-44 truncate">{item.reason}</TableCell>
              <TableCell>
                <Badge variant="outline">{item.status}</Badge>
              </TableCell>
              <TableCell>
                {capabilities.scopes.includes("quota:reverse") && item.type !== "reversal" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => reverse.mutate(item)}
                    disabled={reverse.isPending || instance.readOnly}
                  >
                    {m.reverse}
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function TransferDialog({
  open,
  onOpenChange,
  instance,
  capabilities,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  instance: MoreTokenInstance
  capabilities: ManagementCapabilities
  onDone: () => void
}) {
  const m = useT().management
  const formRef = useRef<HTMLFormElement>(null)
  const [preview, setPreview] = useState<{
    preview_token: string
    impact: Array<{ id: number; quota: number }>
  } | null>(null)
  const [previewPayload, setPreviewPayload] = useState<Omit<
    QuotaTransferBody,
    "preview_token"
  > | null>(null)
  const mutation = useMutation({
    mutationFn: async (payload: Omit<QuotaTransferBody, "preview_token">) => {
      if (!preview)
        return data<{ preview_token: string; impact: Array<{ id: number; quota: number }> }>(
          instance.id,
          { kind: "actionPreview", body: { action: "quota_transfer", payload } }
        )
      await authorizeManagementPreview(instance.id, preview.preview_token)
      return data(instance.id, {
        kind: "quotaTransfer",
        body: { ...payload, preview_token: preview.preview_token },
      })
    },
    onSuccess: (result) => {
      if (!preview && result && typeof result === "object" && "preview_token" in result)
        setPreview(result as NonNullable<typeof preview>)
      else {
        onOpenChange(false)
        onDone()
      }
    },
    onError: (error) => toast.error(errorText(error)),
  })
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setPreview(null)
          setPreviewPayload(null)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <form
          ref={formRef}
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            const payload = {
              operation_id: operationId(),
              source_id: Number(form.get("source_id")),
              target_id: Number(form.get("target_id")),
              amount: Number(form.get("amount")),
              reason: String(form.get("reason")),
            }
            if (!preview) setPreviewPayload(payload)
            mutation.mutate(previewPayload ?? payload)
          }}
        >
          <DialogHeader>
            <DialogTitle>{m.transfer}</DialogTitle>
            <DialogDescription>{m.reasonHint}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4 sm:grid-cols-2">
            <Field name="source_id" label={m.sourceId} type="number" min={1} required />
            <Field name="target_id" label={m.targetId} type="number" min={1} required />
            <Field name="amount" label={m.amount} type="number" min={1} required />
            <Field name="reason" label={m.reason} required />
            {preview ? (
              <div className="sm:col-span-2 rounded-md border p-3">
                <p className="text-sm font-medium">{m.previewImpact}</p>
                {preview.impact.map((item) => (
                  <p key={item.id} className="text-xs tabular-nums">
                    #{item.id}: {number(item.quota)}
                  </p>
                ))}
              </div>
            ) : null}
            {capabilities.role === "admin" || capabilities.role === "root" ? (
              <p className="sm:col-span-2 text-xs text-muted-foreground">
                {m.adjustment}:{" "}
                {capabilities.scopes.includes("quota:adjust") ? m.active : m.noScopes}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {m.cancel}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {preview ? m.confirm : m.preview}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function BatchDialog({
  open,
  onOpenChange,
  instance,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  instance: MoreTokenInstance
  onDone: () => void
}) {
  const m = useT().management
  const [preview, setPreview] = useState<string | null>(null)
  const [payload, setPayload] = useState<Omit<QuotaBatchBody, "preview_token"> | null>(null)
  const [batchId, setBatchId] = useState<number | null>(null)
  const batch = useQuery({
    queryKey: ["more-token", instance.id, "quota-batch", batchId],
    enabled: batchId !== null,
    queryFn: () =>
      data<{
        batch: { id: number; status: string }
        items: Array<{ item_key: string; status: string; error_code?: string }>
      }>(instance.id, { kind: "quotaBatch", id: batchId! }),
    refetchInterval: 2_000,
  })
  const mutation = useMutation({
    mutationFn: async (form: HTMLFormElement) => {
      if (preview && payload) {
        await authorizeManagementPreview(instance.id, preview)
        return data<{ id: number; status: string }>(instance.id, {
          kind: "createQuotaBatch",
          body: { ...payload, preview_token: preview },
        })
      }
      const fields = new FormData(form)
      const items = String(fields.get("items") ?? "")
        .split("\n")
        .filter(Boolean)
        .map((line, index) => {
          const [source, target, amount, ...reason] = line.split(",")
          return {
            item_key: String(index + 1),
            source_id: Number(source),
            target_id: Number(target),
            amount: Number(amount),
            reason: reason.join(",").trim(),
          }
        })
      const next: Omit<QuotaBatchBody, "preview_token"> = {
        batch_operation_id: operationId(),
        mode: fields.get("mode") === "best_effort" ? "best_effort" : "atomic",
        items,
      }
      setPayload(next)
      const result = await data<{ preview_token: string }>(instance.id, {
        kind: "actionPreview",
        body: { action: "quota_batch", payload: next },
      })
      setPreview(result.preview_token)
      return result
    },
    onSuccess: (result) => {
      if (preview && "id" in result) {
        setBatchId(result.id)
        onDone()
      }
    },
    onError: (error) => toast.error(errorText(error)),
  })
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setPreview(null)
          setPayload(null)
          setBatchId(null)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            mutation.mutate(event.currentTarget)
          }}
        >
          <DialogHeader>
            <DialogTitle>{m.batchTransfer}</DialogTitle>
            <DialogDescription>{m.batchItemsHint}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <select name="mode" className="h-9 w-full rounded-md border bg-background px-2 text-sm">
              <option value="atomic">{m.atomic}</option>
              <option value="best_effort">{m.bestEffort}</option>
            </select>
            <Textarea
              name="items"
              rows={8}
              required
              placeholder={"1,2,100000,team allocation\n1,3,50000,trial"}
              className="font-mono text-xs"
            />
            {batch.data ? (
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">
                  {m.batchProgress}: {batch.data.batch.status}
                </p>
                {batch.data.items.some((item) => item.status === "FAILED") ? (
                  <p className="text-xs text-destructive">{m.batchPartialFailure}</p>
                ) : null}
                <div className="max-h-40 space-y-1 overflow-auto text-xs">
                  {batch.data.items.map((item) => (
                    <p key={item.item_key} className="flex justify-between gap-4">
                      <span>{item.item_key}</span>
                      <span className="font-mono">
                        {item.status}
                        {item.error_code ? ` · ${item.error_code}` : ""}
                      </span>
                    </p>
                  ))}
                </div>
              </div>
            ) : null}
            {preview ? (
              <Alert>
                <Check className="size-4" />
                <AlertTitle>{m.previewImpact}</AlertTitle>
                <AlertDescription>{payload?.items.length ?? 0} items</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {m.cancel}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {preview ? m.submitBatch : m.preview}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PolicyEditor({
  policy,
  instance,
  capabilities,
  onDone,
}: {
  policy: QuotaPolicy | null
  instance: MoreTokenInstance
  capabilities: ManagementCapabilities
  onDone: () => void
}) {
  const m = useT().management
  const mutation = useMutation({
    mutationFn: async (draft: QuotaPolicy & { reason: string }) => {
      const payload = { account_id: draft.master_id, ...draft }
      const preview = await data<{ preview_token: string }>(instance.id, {
        kind: "actionPreview",
        body: { action: "quota_policy_update", payload },
      })
      await authorizeManagementPreview(instance.id, preview.preview_token)
      const body: UpdateQuotaPolicyBody = { ...draft, preview_token: preview.preview_token }
      return data(instance.id, { kind: "updateQuotaPolicy", body })
    },
    onSuccess: onDone,
    onError: (error) => toast.error(errorText(error)),
  })
  if (!policy)
    return (
      <section className="border-y p-5">
        <Skeleton className="h-64" />
      </section>
    )
  const canWrite = capabilities.scopes.includes("policy:write") && !instance.readOnly
  return (
    <section className="border-y py-4">
      <h3 className="font-medium">{m.policies}</h3>
      <div className="mt-4">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            mutation.mutate({
              ...policy,
              reason: String(form.get("reason") ?? ""),
              minimum_reserve: Number(form.get("minimum_reserve")),
              child_balance_cap: Number(form.get("child_balance_cap")),
              single_transfer_limit: Number(form.get("single_transfer_limit")),
              daily_transfer_limit: Number(form.get("daily_transfer_limit")),
              auto_refill_enabled: form.get("auto_refill_enabled") === "on",
              auto_refill_threshold: Number(form.get("auto_refill_threshold")),
              auto_refill_amount: Number(form.get("auto_refill_amount")),
              auto_refill_daily_cap: Number(form.get("auto_refill_daily_cap")),
              auto_refill_cooldown_sec: Number(form.get("auto_refill_cooldown_sec")),
              monthly_soft_budget: Number(form.get("monthly_soft_budget")),
              disable_on_exhaustion: form.get("disable_on_exhaustion") === "on",
            })
          }}
        >
          <PolicyNumber
            name="minimum_reserve"
            label={m.minimumReserve}
            value={policy.minimum_reserve}
          />
          <PolicyNumber
            name="child_balance_cap"
            label={m.childBalanceCap}
            value={policy.child_balance_cap}
          />
          <PolicyNumber
            name="single_transfer_limit"
            label={m.singleTransferLimit}
            value={policy.single_transfer_limit}
          />
          <PolicyNumber
            name="daily_transfer_limit"
            label={m.dailyTransferLimit}
            value={policy.daily_transfer_limit}
          />
          <Separator />
          <label className="flex items-center justify-between gap-3 text-sm">
            {m.autoRefill}
            <Switch name="auto_refill_enabled" defaultChecked={policy.auto_refill_enabled} />
          </label>
          <Field name="reason" label={m.reason} required />
          <PolicyNumber
            name="auto_refill_threshold"
            label={m.autoRefillThreshold}
            value={policy.auto_refill_threshold}
          />
          <PolicyNumber
            name="auto_refill_amount"
            label={m.autoRefillAmount}
            value={policy.auto_refill_amount}
          />
          <PolicyNumber
            name="auto_refill_daily_cap"
            label={m.autoRefillDailyCap}
            value={policy.auto_refill_daily_cap}
          />
          <PolicyNumber
            name="auto_refill_cooldown_sec"
            label={m.cooldown}
            value={policy.auto_refill_cooldown_sec}
          />
          <PolicyNumber
            name="monthly_soft_budget"
            label={m.monthlyBudget}
            value={policy.monthly_soft_budget}
          />
          <label className="flex items-center justify-between gap-3 text-sm">
            {m.disableOnExhaustion}
            <Switch name="disable_on_exhaustion" defaultChecked={policy.disable_on_exhaustion} />
          </label>
          {!capabilities.features.quota_policy_automation_enabled ? (
            <p className="text-xs text-[var(--hm-warn)]">{m.automationOff}</p>
          ) : null}
          <Button type="submit" className="w-full" disabled={!canWrite || mutation.isPending}>
            {m.savePolicy}
          </Button>
        </form>
      </div>
    </section>
  )
}

function PolicyNumber({ name, label, value }: { name: string; label: string; value: number }) {
  return (
    <div className="grid grid-cols-[1fr_8rem] items-center gap-3">
      <Label htmlFor={name} className="text-xs">
        {label}
      </Label>
      <Input
        id={name}
        name={name}
        type="number"
        min={0}
        defaultValue={value}
        className="text-right tabular-nums"
      />
    </div>
  )
}

function AnalyticsView({
  instance,
  localUsage,
}: {
  instance: MoreTokenInstance
  localUsage: MoreTokenSectionProps["localUsage"]
}) {
  const m = useT().management
  const [start, setStart] = useState(() => Math.floor(Date.now() / 1000) - 30 * 86400)
  const [end, setEnd] = useState(() => Math.floor(Date.now() / 1000))
  const [model, setModel] = useState("")
  const [group, setGroup] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [status, setStatus] = useState<"success" | "error" | "all">("success")
  const analytics = useQuery({
    queryKey: ["more-token", instance.id, "analytics", start, end, model, group, apiKey, status],
    queryFn: ({ signal }) =>
      data<AnalyticsData>(
        instance.id,
        {
          kind: "analytics",
          start,
          end,
          model: model || null,
          group: group || null,
          apiKey: apiKey || null,
          status,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        signal
      ),
  })
  const localTokens = useMemo(
    () =>
      (localUsage.data?.sessions ?? [])
        .flatMap((session) => session.events)
        .filter((event) => event[EV.ts] >= start * 1000 && event[EV.ts] <= end * 1000)
        .reduce(
          (sum, event) =>
            sum + event[EV.input] + event[EV.output] + event[EV.cacheRead] + event[EV.cacheWrite],
          0
        ),
    [end, localUsage.data, start]
  )
  const exportCsv = () => {
    if (!analytics.data) return
    downloadCsv(`more-token-usage-${instance.id}-${analytics.data.generated_at}.csv`, [
      [m.analyticsDefinition],
      [m.instance, instance.name],
      [m.timezone, analytics.data.timezone],
      [m.generatedAt, formatTime(analytics.data.generated_at)],
      [m.from, formatTime(start)],
      [m.to, formatTime(end)],
      [],
      ["bucket", "rpm", "tpm", "quota"],
      ...analytics.data.series.map((point) => [point.bucket, point.rpm, point.tpm, point.quota]),
    ])
  }
  return (
    <div className="space-y-5">
      <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-6">
        <FieldValue label={m.from}>
          <Input
            type="datetime-local"
            value={new Date(start * 1000).toISOString().slice(0, 16)}
            onChange={(event) =>
              setStart(Math.floor(new Date(event.target.value).getTime() / 1000))
            }
          />
        </FieldValue>
        <FieldValue label={m.to}>
          <Input
            type="datetime-local"
            value={new Date(end * 1000).toISOString().slice(0, 16)}
            onChange={(event) => setEnd(Math.floor(new Date(event.target.value).getTime() / 1000))}
          />
        </FieldValue>
        <FieldValue label={m.model}>
          <Input value={model} onChange={(event) => setModel(event.target.value)} />
        </FieldValue>
        <FieldValue label={m.group}>
          <Input value={group} onChange={(event) => setGroup(event.target.value)} />
        </FieldValue>
        <FieldValue label={m.apiKey}>
          <Input value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
        </FieldValue>
        <FieldValue label={m.status}>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          >
            <option value="success">{m.success}</option>
            <option value="error">{m.error}</option>
            <option value="all">{m.all}</option>
          </select>
        </FieldValue>
      </div>
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!analytics.data}>
          <Download className="size-4" />
          {m.exportCsv}
        </Button>
      </div>
      <div className="grid overflow-hidden rounded-lg border lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
        <section className="min-w-0 p-5 lg:border-r">
          <h3 className="font-medium">{m.serverBilling}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {analytics.data?.definition ?? m.analyticsDefinition}
          </p>
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Metric
              label={m.requests}
              value={analytics.data ? number(analytics.data.metrics.requests) : "—"}
            />
            <Metric
              label={m.promptTokens}
              value={analytics.data ? number(analytics.data.metrics.prompt_tokens) : "—"}
            />
            <Metric
              label={m.completionTokens}
              value={analytics.data ? number(analytics.data.metrics.completion_tokens) : "—"}
            />
            <Metric
              label={m.peakRpm}
              value={analytics.data ? number(analytics.data.metrics.peak_rpm) : "—"}
            />
            <Metric
              label={m.peakTpm}
              value={analytics.data ? number(analytics.data.metrics.peak_tpm) : "—"}
            />
            <Metric
              label={m.totalQuota}
              value={analytics.data ? number(analytics.data.metrics.quota) : "—"}
            />
          </div>
        </section>
        <section className="border-t p-5 lg:border-t-0">
          <h3 className="font-medium">{m.localEstimate}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{m.localEstimateHint}</p>
          <div className="mt-5">
            {localUsage.data ? (
              <Metric label={m.localTokens} value={number(localTokens)} />
            ) : (
              <Button variant="outline" onClick={localUsage.request} disabled={localUsage.loading}>
                {localUsage.loading ? m.loading : m.localEstimate}
              </Button>
            )}
          </div>
        </section>
      </div>
      <section className="border-y py-5">
        <h3 className="font-medium">{m.throughput}</h3>
        <div className="mt-5">
          <UsageBars series={analytics.data?.series ?? []} />
        </div>
      </section>
    </div>
  )
}

function FieldValue({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  )
}

function UsageBars({ series }: { series: AnalyticsData["series"] }) {
  const m = useT().management
  const max = Math.max(1, ...series.map((point) => point.tpm))
  const visible = series.slice(-60)
  return (
    <div className="flex h-44 items-end gap-px" role="img" aria-label={m.usageOverTime}>
      {visible.map((point) => (
        <div
          key={point.bucket}
          className="min-w-0 flex-1 bg-[var(--hm-accent)]"
          style={{ height: `${Math.max(2, (point.tpm / max) * 100)}%` }}
          title={`${formatTime(point.bucket)} · TPM ${point.tpm}`}
        />
      ))}
    </div>
  )
}

function AuditView({
  instance,
  capabilities,
}: {
  instance: MoreTokenInstance
  capabilities: ManagementCapabilities
}) {
  const m = useT().management
  const queryClient = useQueryClient()
  const [ruleOpen, setRuleOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null)
  const [auditPage, setAuditPage] = useState(1)
  const [auditAction, setAuditAction] = useState("")
  const [rulePage, setRulePage] = useState(1)
  const [ruleSearch, setRuleSearch] = useState("")
  const [eventPage, setEventPage] = useState(1)
  const [detailId, setDetailId] = useState<number | null>(null)
  const audits = useQuery({
    queryKey: ["more-token", instance.id, "audit", auditPage, auditAction],
    queryFn: ({ signal }) =>
      data<Page<AuditEvent>>(
        instance.id,
        { kind: "auditEvents", page: auditPage, pageSize: 25, action: auditAction || null },
        signal
      ),
  })
  const rules = useQuery({
    queryKey: ["more-token", instance.id, "alert-rules", rulePage, ruleSearch],
    queryFn: ({ signal }) =>
      data<Page<AlertRule>>(
        instance.id,
        { kind: "alertRules", page: rulePage, pageSize: 20, search: ruleSearch || null },
        signal
      ),
  })
  const events = useQuery({
    queryKey: ["more-token", instance.id, "alert-events", eventPage],
    queryFn: ({ signal }) =>
      data<Page<AlertEvent>>(
        instance.id,
        { kind: "alertEvents", page: eventPage, pageSize: 25 },
        signal
      ),
  })
  const detail = useQuery({
    queryKey: ["more-token", instance.id, "account", detailId],
    queryFn: () =>
      data<{ account: AccountDetail }>(instance.id, { kind: "account", id: detailId! }),
    enabled: detailId !== null,
  })
  useEffect(() => {
    if (!detail.isError || detailId === null) return
    toast.error(errorText(detail.error))
  }, [detail.error, detail.isError, detailId])
  const ack = useMutation({
    mutationFn: (id: number) => data(instance.id, { kind: "acknowledgeAlert", id }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["more-token", instance.id, "alert-events"] }),
  })
  const mutateRule = useMutation({
    mutationFn: (rule: AlertRule) =>
      data(instance.id, {
        kind: "updateAlertRule",
        id: rule.id,
        body: {
          name: rule.name,
          kind: rule.kind,
          threshold: rule.threshold,
          enabled: rule.enabled,
          cooldown_sec: rule.cooldown_sec,
          version: rule.version,
        },
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["more-token", instance.id, "alert-rules"] }),
    onError: (error) => toast.error(errorText(error)),
  })
  const deleteRule = useMutation({
    mutationFn: (id: number) => data(instance.id, { kind: "deleteAlertRule", id }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["more-token", instance.id, "alert-rules"] }),
    onError: (error) => toast.error(errorText(error)),
  })
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
      <section className="border-y py-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="font-medium">{m.auditTimeline}</h3>
          <Input
            value={auditAction}
            onChange={(event) => {
              setAuditAction(event.target.value)
              setAuditPage(1)
            }}
            className="sm:max-w-56"
            placeholder={m.auditActionFilter}
          />
        </div>
        <div className="mt-5">
          <div className="space-y-0">
            {audits.data?.items.map((event, index) => (
              <div key={event.id} className="relative grid grid-cols-[18px_1fr] gap-3 pb-5">
                <div className="relative">
                  <span className="absolute left-[7px] top-3 size-2 rounded-full bg-[var(--hm-accent)]" />
                  {index < (audits.data?.items.length ?? 0) - 1 ? (
                    <span className="absolute bottom-[-4px] left-[10px] top-5 w-px bg-border" />
                  ) : null}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{event.action}</p>
                    {event.error_code ? (
                      <Badge variant="destructive">{event.error_code}</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {event.resource_type} #{event.resource_id} · {formatTime(event.created_at)}
                  </p>
                  <p className="mt-2 text-sm">{event.reason || "—"}</p>
                  {event.before || event.after ? (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer text-muted-foreground">
                        {m.before} / {m.after}
                      </summary>
                      <pre className="mt-2 max-h-44 overflow-auto rounded-md bg-muted p-2">
                        {event.before || "—"}
                        {"\n→\n"}
                        {event.after || "—"}
                      </pre>
                    </details>
                  ) : null}
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                    {m.requestId}: {event.request_id}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <PageControls
          page={auditPage}
          pageSize={25}
          total={audits.data?.total ?? 0}
          onPage={setAuditPage}
        />
      </section>
      <div className="divide-y border-y">
        <section className="py-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-medium">{m.alertRules}</h3>
            <Button
              size="sm"
              onClick={() => {
                setEditingRule(null)
                setRuleOpen(true)
              }}
              disabled={instance.readOnly || !capabilities.scopes.includes("alerts:write")}
            >
              <Plus className="size-4" />
              {m.createRule}
            </Button>
          </div>
          <Input
            value={ruleSearch}
            onChange={(event) => {
              setRuleSearch(event.target.value)
              setRulePage(1)
            }}
            className="mt-3"
            placeholder={m.searchAlertRules}
          />
          <div className="mt-4 space-y-2">
            {rules.data?.items.length ? (
              rules.data.items.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      setEditingRule(rule)
                      setRuleOpen(true)
                    }}
                  >
                    <p className="text-sm font-medium">{rule.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {rule.kind} · {number(rule.threshold)}
                    </p>
                  </button>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={rule.enabled}
                      disabled={instance.readOnly || mutateRule.isPending}
                      onCheckedChange={(enabled) => mutateRule.mutate({ ...rule, enabled })}
                      aria-label={`${rule.name}: ${rule.enabled ? m.active : m.disabled}`}
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={instance.readOnly || deleteRule.isPending}
                      onClick={() => {
                        if (window.confirm(`${m.delete}: ${rule.name}?`)) deleteRule.mutate(rule.id)
                      }}
                      aria-label={`${m.delete}: ${rule.name}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{m.noData}</p>
            )}
          </div>
          <PageControls
            page={rulePage}
            pageSize={20}
            total={rules.data?.total ?? 0}
            onPage={setRulePage}
          />
        </section>
        <section className="py-5">
          <h3 className="font-medium">{m.alertEvents}</h3>
          <div className="mt-4 space-y-2">
            {events.data?.items.map((event) => (
              <div key={event.id} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{event.message}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatTime(event.created_at)} · {number(event.observed_value)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {event.acknowledged_at ? (
                      <Badge variant="outline">{m.acknowledged}</Badge>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => ack.mutate(event.id)}>
                        {m.acknowledge}
                      </Button>
                    )}
                    {event.account_id > 0 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDetailId(event.account_id)}
                      >
                        {m.viewAccount(event.account_id)}
                        <ChevronRight className="size-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <PageControls
            page={eventPage}
            pageSize={25}
            total={events.data?.total ?? 0}
            onPage={setEventPage}
          />
        </section>
      </div>
      <AlertRuleDialog
        open={ruleOpen}
        onOpenChange={setRuleOpen}
        instance={instance}
        rule={editingRule}
        onDone={() =>
          queryClient.invalidateQueries({ queryKey: ["more-token", instance.id, "alert-rules"] })
        }
      />
      <AccountDetailSheet
        key={detailId ?? "closed"}
        account={detail.data?.account ?? null}
        quotaDisplay={capabilities.quota_display}
        instance={instance}
        capabilities={capabilities}
        onDone={() => queryClient.invalidateQueries({ queryKey: ["more-token", instance.id] })}
        onOpenChange={(open) => !open && setDetailId(null)}
      />
    </div>
  )
}

function AlertRuleDialog({
  open,
  onOpenChange,
  instance,
  rule,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  instance: MoreTokenInstance
  rule: AlertRule | null
  onDone: () => void
}) {
  const m = useT().management
  const mutation = useMutation({
    mutationFn: (body: AlertRuleBody) =>
      rule
        ? data(instance.id, { kind: "updateAlertRule", id: rule.id, body })
        : data(instance.id, { kind: "createAlertRule", body }),
    onSuccess: () => {
      onOpenChange(false)
      onDone()
    },
    onError: (error) => toast.error(errorText(error)),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            mutation.mutate({
              name: String(form.get("name") ?? ""),
              kind: String(form.get("kind")) as AlertRuleBody["kind"],
              threshold: Number(form.get("threshold")),
              cooldown_sec: Number(form.get("cooldown_sec")),
              enabled: true,
              version: rule?.version,
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>{rule ? m.edit : m.createRule}</DialogTitle>
            <DialogDescription>{m.pendingAlerts}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Field name="name" label={m.ruleName} defaultValue={rule?.name} required />
            <FieldValue label={m.ruleKind}>
              <select
                name="kind"
                defaultValue={rule?.kind}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="balance_below">{m.balanceBelow}</option>
                <option value="monthly_budget">{m.monthlyBudgetRule}</option>
                <option value="token_exhausted">{m.tokenExhausted}</option>
              </select>
            </FieldValue>
            <Field
              name="threshold"
              label={m.threshold}
              type="number"
              min={0}
              defaultValue={rule?.threshold}
              required
            />
            <Field
              name="cooldown_sec"
              label={m.cooldown}
              type="number"
              min={1}
              defaultValue={rule?.cooldown_sec ?? 3600}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {m.cancel}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {m.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function InstanceDialog({
  open,
  onOpenChange,
  instance,
  onSaved,
  onRemoved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  instance: MoreTokenInstance | null
  onSaved: (instance: MoreTokenInstance) => void
  onRemoved: () => void
}) {
  const m = useT().management
  const [suggestedId] = useState(() => `more-token-${Date.now().toString(36)}`)
  const mutation = useMutation({
    mutationFn: saveInstance,
    onSuccess: (saved) => {
      onOpenChange(false)
      onSaved(saved)
    },
    onError: (error) => toast.error(errorText(error)),
  })
  const remove = useMutation({
    mutationFn: () => removeInstance(instance!.id),
    onSuccess: () => {
      onOpenChange(false)
      onRemoved()
    },
    onError: (error) => toast.error(errorText(error)),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            mutation.mutate({
              id: String(form.get("id")),
              name: String(form.get("name")),
              baseUrl: String(form.get("base_url")),
              readOnly: form.get("read_only") === "on",
              displayCurrency: String(form.get("display_currency") || "") || null,
              package: instance?.package ?? "management",
              customCaPath: String(form.get("custom_ca_path") || "") || null,
              clearCustomCa: form.get("clear_custom_ca") === "on",
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>{instance ? m.editInstance : m.addInstance}</DialogTitle>
            <DialogDescription>{m.customCaHint}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Field
              name="id"
              label={m.instanceId}
              defaultValue={instance?.id ?? suggestedId}
              readOnly={!!instance}
              required
              pattern="[A-Za-z0-9_-]+"
            />
            <Field
              name="name"
              label={m.instanceName}
              defaultValue={instance?.name ?? "more-token"}
              required
            />
            <Field
              name="base_url"
              label={m.instanceUrl}
              defaultValue={instance?.baseUrl ?? "https://"}
              required
            />
            <Field name="custom_ca_path" label={m.customCa} />
            <Field
              name="display_currency"
              label={m.displayCurrency}
              defaultValue={instance?.displayCurrency ?? ""}
              maxLength={8}
            />
            <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
              {m.readOnly}
              <Switch name="read_only" defaultChecked={instance?.readOnly} />
            </label>
            {instance?.caFingerprint ? (
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <Checkbox name="clear_custom_ca" />
                Remove CA ·{" "}
                <code className="truncate text-xs">{instance.caFingerprint.slice(0, 16)}…</code>
              </label>
            ) : null}
          </div>
          <DialogFooter className="sm:justify-between">
            {instance ? (
              <Button
                type="button"
                variant="destructive"
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
              >
                <Trash2 className="size-4" />
                {m.removeInstance}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {m.cancel}
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {m.save}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
