/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 */
/* Hallmark · genre: modern-minimal · macrostructure: Workbench · design-system: design.md · designed-as-app */
"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  ArrowLeftRight,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Download,
  KeyRound,
  ListTree,
  Network,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  Unplug,
  X,
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
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
import { AccountActionsMenu } from "./account-actions-menu"
import { AccountDetailSheet } from "./account-detail-sheet"
import { useConfirm } from "./confirm-dialog"
import { useForgetCredential } from "./credential"
import { saveCsv } from "./csv"
import { errorText } from "./errors"
import { InstanceDialog } from "./instance-dialog"
import { useStepUp } from "./use-step-up"
import { isTauri } from "@/lib/tauri"
import { hasInjectedMoreTokenPort } from "@/lib/more-token/port"
import { useT } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { notify } from "@/lib/tauri/system"
import {
  credentialState,
  listInstances,
  managementRequest,
  ManagementApiError,
  operationId,
  pairInstance,
} from "@/lib/more-token/client"
import { parseLocalDateTimeInput, toLocalDateTimeInput } from "@/lib/more-token/datetime"
import { isStepUpCancelled } from "@/lib/more-token/step-up"
import { accountsCsvRows } from "@/lib/more-token/accounts"
import {
  quotaAmountParts,
  quotaAmountWithRaw,
  quotaTransactionsCsvRows,
} from "@/lib/more-token/quota"
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

/** A write the user stopped (Cancel on a browser approval) is not a failure. */
function reportError(error: unknown) {
  if (!isStepUpCancelled(error)) toast.error(errorText(error))
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
  // Add and edit are the same dialog with different subjects. `seq` remounts it
  // per opening so an add never inherits an edit's fields or a previous add's
  // suggested id.
  const [instanceDialog, setInstanceDialog] = useState<{
    open: boolean
    mode: "add" | "edit"
    seq: number
  }>({ open: false, mode: "add", seq: 0 })
  const openInstanceDialog = (mode: "add" | "edit") =>
    setInstanceDialog((current) => ({ open: true, mode, seq: current.seq + 1 }))
  const { forget, dialog: forgetDialog } = useForgetCredential()
  // Legacy records predate the package discriminator and remain management
  // connections. Explicit personal records never enter this surface.
  const instances = (instancesQuery.data ?? []).filter((item) => item.package !== "personal")
  // A selection the list no longer holds (removed, or not refetched yet) falls
  // back to the first instance rather than to a null one.
  const activeId = instances.some((item) => item.id === selectedId)
    ? selectedId
    : instances[0]?.id || ""
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
  // Ids are per server, so the delivered set is keyed by instance too: two
  // instances can each hand out notification 1.
  const delivered = useRef(new Set<string>())

  useEffect(() => {
    const items = notificationQuery.data ?? []
    for (const item of items) {
      const key = `${activeId}:${item.id}`
      if (delivered.current.has(key)) continue
      delivered.current.add(key)
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

  const actions =
    // With no instance yet, the empty state's own "Add instance" is the one way
    // in; this header copy (and the aside's) would make it three buttons for
    // one action on an otherwise empty page.
    instances.length === 0 ? null : (
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => openInstanceDialog("add")}>
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
      action={<Button onClick={() => openInstanceDialog("add")}>{m.addInstance}</Button>}
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
        <OverviewView
          instances={instances}
          activeId={activeId}
          quotaDisplay={capabilities.data.quota_display}
        />
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
              // No instance is nothing to measure, not an unavailable one.
              !instance ||
              instancesQuery.isLoading ||
              credentialQuery.isLoading ||
              credentialQuery.isError
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
                  <Button variant="outline" size="sm" onClick={() => openInstanceDialog("edit")}>
                    {m.editInstance}
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
                      {m.disconnect}
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
        <>
          <InstanceDialog
            key={instanceDialog.seq}
            open={instanceDialog.open}
            instance={instanceDialog.mode === "edit" ? instance : null}
            pkg="management"
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
  quotaDisplay,
}: {
  instances: MoreTokenInstance[]
  activeId: string
  quotaDisplay: QuotaDisplaySetting
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
      {/* Container-sized: the window-wide `lg` step put four columns into the
          ~570px primary of a 1100px window and cut the instance's name to
          "More To…". Narrower, the name takes its own row over the figures. */}
      <div className="@container overflow-hidden rounded-md border divide-y">
        {overviewQueries.map((query, index) => {
          const item = instances[index]
          return (
            <div
              key={item.id}
              className="grid grid-cols-2 gap-3 p-4 @md:grid-cols-3 @2xl:grid-cols-[minmax(160px,0.8fr)_repeat(3,minmax(100px,0.55fr))] @2xl:items-center"
            >
              <div className="col-span-full flex min-w-0 items-center justify-between gap-3 @2xl:col-span-1 @2xl:justify-start">
                <span className="truncate text-sm font-medium">{item.name}</span>
                <Badge
                  variant={
                    query.isError ? "destructive" : query.isPending ? "secondary" : "outline"
                  }
                >
                  {query.isError ? m.unavailable : query.isPending ? m.loading : m.healthy}
                </Badge>
              </div>
              {query.isError ? (
                <p className="col-span-full text-xs text-muted-foreground [overflow-wrap:anywhere] @2xl:col-span-3">
                  {errorText(query.error)}
                </p>
              ) : query.data ? (
                <>
                  <Metric label={m.accounts} value={number(query.data.summary.accounts)} />
                  <Metric label={m.totalQuota} value={number(query.data.summary.total_quota)} />
                  <Metric label={m.openAlerts} value={number(query.data.open_alerts)} />
                </>
              ) : (
                <Skeleton className="col-span-full h-12 @2xl:col-span-3" />
              )}
            </div>
          )
        })}
      </div>
      <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]">
        <section className="border-y py-5">
          <div>
            <h3 className="flex items-center gap-2 font-medium">
              <ListTree className="size-4" />
              {m.topology}
            </h3>
            <p className="text-xs text-muted-foreground">{m.topologyHint}</p>
          </div>
          <div className="mt-4">
            {accounts.isError ? (
              <ErrorPanel error={accounts.error} retry={() => void accounts.refetch()} />
            ) : accounts.isLoading ? (
              <Skeleton className="h-52" />
            ) : (
              <Topology accounts={accounts.data?.items ?? []} quotaDisplay={quotaDisplay} />
            )}
          </div>
        </section>
        <div className="divide-y border-y">
          <section className="py-5">
            <h3 className="font-medium">{m.balanceRisk}</h3>
            <div className="mt-4">
              {accounts.isError ? (
                <p className="text-sm text-muted-foreground">{m.unavailable}</p>
              ) : accounts.isLoading ? (
                <Skeleton className="h-16" />
              ) : (
                <RiskDistribution accounts={accounts.data?.items ?? []} />
              )}
            </div>
          </section>
          <section className="py-5">
            <h3 className="flex items-center gap-2 font-medium">
              <Bell className="size-4" />
              {m.pendingAlerts}
            </h3>
            <div className="mt-4 space-y-2">
              {alerts.isError ? (
                <ErrorPanel error={alerts.error} retry={() => void alerts.refetch()} />
              ) : alerts.isLoading ? (
                <Skeleton className="h-16" />
              ) : alerts.data?.items.length ? (
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

/**
 * One cell of the quota summary. A quota amount arrives as one string, "CNY
 * 610.0462 · 305,023,119 quota"; the converted amount is what is read, so it is
 * set large and the raw quota under it as its unit-level footnote.
 */
function SummaryCell({ label, value }: { label: string; value: string }) {
  const [head, ...rest] = value.split(" · ")
  return (
    <div className="min-w-0 bg-background px-4 py-3">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-xl font-semibold tracking-tight tabular-nums [overflow-wrap:anywhere]">
        {head}
      </dd>
      {rest.length > 0 ? (
        <dd className="mt-0.5 font-mono text-xs text-muted-foreground tabular-nums [overflow-wrap:anywhere]">
          {rest.join(" · ")}
        </dd>
      ) : null}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold tabular-nums [overflow-wrap:anywhere]">
        {value}
      </p>
    </div>
  )
}

function TreeNode({
  label,
  value,
  master = false,
  onSelect,
}: {
  label: string
  value: string
  master?: boolean
  onSelect?: () => void
}) {
  const className = master
    ? "block min-w-0 rounded-[var(--hm-radius-control)] border-l-2 border-[var(--hm-accent)] bg-muted/40 p-2 text-left"
    : "inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-[var(--hm-radius-control)] border px-2 py-1 text-xs"
  const content = (
    <>
      <span className={cn("truncate font-medium", master && "block text-sm")}>{label}</span>
      <span
        className={cn("font-mono tabular-nums text-muted-foreground", master && "block text-xs")}
      >
        {value}
      </span>
    </>
  )
  if (!onSelect) return <span className={className}>{content}</span>
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        className,
        master ? "hover:bg-muted" : "hover:bg-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      )}
    >
      {content}
    </button>
  )
}

function Topology({
  accounts,
  quotaDisplay,
  onSelect,
  onViewChildren,
}: {
  accounts: Account[]
  quotaDisplay: QuotaDisplaySetting
  /** Absent on the overview, which has no detail sheet to open. */
  onSelect?: (account: Account) => void
  onViewChildren?: (account: Account) => void
}) {
  const m = useT().management
  const masters = accounts.filter((account) => account.is_master)
  if (!masters.length) return <p className="text-sm text-muted-foreground">{m.noData}</p>
  return (
    <div className="min-w-0 space-y-3">
      {onSelect ? <p className="text-xs text-muted-foreground">{m.treeScope}</p> : null}
      <ul className="min-w-0 space-y-3">
        {masters.map((master) => {
          const children = accounts.filter((account) => account.master_id === master.id)
          const shown = children.slice(0, 12)
          return (
            <li
              key={master.id}
              className="grid min-w-0 grid-cols-[minmax(8rem,0.35fr)_18px_minmax(0,1fr)] items-start gap-2"
            >
              <TreeNode
                label={master.username}
                value={quotaAmountParts(master.quota, quotaDisplay).primary}
                master
                onSelect={onSelect && (() => onSelect(master))}
              />
              <ChevronRight
                aria-hidden="true"
                className="mt-3 size-4 shrink-0 text-muted-foreground"
              />
              <div className="flex min-w-0 flex-wrap gap-2">
                {shown.length ? (
                  shown.map((child) => (
                    <TreeNode
                      key={child.id}
                      label={child.username}
                      value={quotaAmountParts(child.quota, quotaDisplay).primary}
                      onSelect={onSelect && (() => onSelect(child))}
                    />
                  ))
                ) : (
                  <span className="py-2 text-xs text-muted-foreground">{m.childrenCount(0)}</span>
                )}
                {children.length > shown.length && onViewChildren ? (
                  <button
                    type="button"
                    onClick={() => onViewChildren(master)}
                    className="inline-flex items-center rounded-[var(--hm-radius-control)] border border-dashed px-2 py-1 text-xs text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {m.moreChildren(children.length - shown.length)}
                  </button>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
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

const FILTER_SELECT_CLASS =
  "h-9 w-full min-w-0 appearance-none rounded-[var(--hm-radius-control)] border bg-background pl-3 pr-8 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

/**
 * One dropdown shape for the whole account center, so the toolbar and the
 * filter popover read as the same control at two different labellings.
 */
function FilterSelect({
  id,
  label,
  hideLabel = false,
  value,
  onChange,
  className,
  children,
}: {
  id: string
  label: string
  hideLabel?: boolean
  value: string
  onChange: (value: string) => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <Label
        htmlFor={id}
        className={cn(
          hideLabel ? "sr-only" : "mb-1.5 block text-xs font-normal text-muted-foreground"
        )}
      >
        {label}
      </Label>
      <div className="relative min-w-0">
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={FILTER_SELECT_CLASS}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
      </div>
    </div>
  )
}

/**
 * Access status and lifecycle are two server fields but one question — can this
 * account be used right now — so they read as a single dot and a single word.
 */
function AccountStatusMark({ account }: { account: Account }) {
  const m = useT().management
  const state = account.lifecycle_state || "active"
  const [tone, label] =
    state === "archived"
      ? (["bg-[var(--hm-neutral)]", m.archived] as const)
      : state === "closing"
        ? (["bg-[var(--hm-warn)]", m.closing] as const)
        : account.status === 1
          ? (["bg-[var(--hm-ok)]", m.enabled] as const)
          : (["bg-[var(--hm-warn)]", m.disabled] as const)
  return (
    <span className="inline-flex min-w-0 items-center gap-2 whitespace-nowrap">
      <span
        aria-hidden="true"
        className={cn("size-1.5 shrink-0 rounded-[var(--hm-radius-dot)]", tone)}
      />
      {label}
    </span>
  )
}

function AccountRoleBadge({ account }: { account: Account }) {
  const m = useT().management
  const label =
    account.role >= 100
      ? m.root
      : account.role >= 10
        ? m.admin
        : account.is_master
          ? m.master
          : m.user
  return (
    <Badge variant="outline" className="font-normal">
      {label}
    </Badge>
  )
}

function AccountRelationText({
  account,
  onViewChildren,
}: {
  account: Account
  onViewChildren?: (account: Account) => void
}) {
  const m = useT().management
  if (account.master_id > 0)
    return <span className="whitespace-nowrap">{m.childOf(account.master_id)}</span>
  if (!account.is_master)
    return <span className="whitespace-nowrap text-muted-foreground">{m.independent}</span>
  const label = m.childrenCount(account.children_count ?? 0)
  // A master with children is the one relationship you can walk into: the
  // server can scope a page to it, so the count doubles as the way there.
  if (!onViewChildren || !account.children_count)
    return <span className="whitespace-nowrap">{label}</span>
  return (
    <button
      type="button"
      onClick={() => onViewChildren(account)}
      title={m.viewChildren}
      className="whitespace-nowrap rounded-[var(--hm-radius-control)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {label}
    </button>
  )
}

/** A column header that carries the sort state it sets. */
function SortableHead({
  column,
  label,
  sortBy,
  sortOrder,
  onSort,
  className,
}: {
  column: "username" | "quota"
  label: string
  sortBy: string
  sortOrder: "asc" | "desc"
  onSort: (column: "username" | "quota") => void
  className?: string
}) {
  const m = useT().management
  const active = sortBy === column
  return (
    <TableHead
      className={className}
      aria-sort={active ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        title={m.sortByColumn(label)}
        className={cn(
          "inline-flex items-center gap-1 rounded-[var(--hm-radius-control)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          className?.includes("text-right") && "flex-row-reverse",
          active && "text-foreground"
        )}
      >
        {label}
        {active ? (
          sortOrder === "asc" ? (
            <ChevronUp aria-hidden="true" className="size-3.5" />
          ) : (
            <ChevronDown aria-hidden="true" className="size-3.5" />
          )
        ) : null}
      </button>
    </TableHead>
  )
}

/**
 * The converted amount leads and the raw quota follows as its meta line — the
 * raw value stays authoritative, so it never gets dropped, only demoted.
 */
function AccountBalanceText({
  value,
  display,
  className,
  align = "right",
}: {
  value: number
  display: QuotaDisplaySetting
  className?: string
  align?: "left" | "right"
}) {
  const parts = quotaAmountParts(value, display)
  return (
    <span className={cn("block min-w-0", align === "right" && "text-right", className)}>
      <span className="block truncate font-mono text-sm tabular-nums">{parts.primary}</span>
      {parts.raw ? (
        <span className="block truncate font-mono text-xs tabular-nums text-muted-foreground">
          {parts.raw}
        </span>
      ) : null}
    </span>
  )
}

function AccountsSkeleton() {
  return (
    <div className="space-y-2 p-3" aria-busy="true">
      <Skeleton className="h-11" />
      <Skeleton className="h-11" />
      <Skeleton className="h-11" />
      <Skeleton className="h-11" />
    </div>
  )
}

const NO_SELECTION: ReadonlySet<number> = new Set<number>()

type BulkAction = "enable" | "disable" | "archive"

interface AccountFilterChip {
  key: string
  /** Omitted when the label already names the field it narrows. */
  field?: string
  label: string
  clear: () => void
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
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc")
  // The server can scope a page to one master. Reaching it needs a name to put
  // on the filter chip, which only the row that opened it knows.
  const [master, setMaster] = useState<{ id: number; username: string } | null>(null)
  const [page, setPage] = useState(1)
  const pageSize = 25
  const [tree, setTree] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [action, setAction] = useState<{
    account: Account
    action: AccountAction | "close"
  } | null>(null)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])
  // A batch acts on ids and only the current page is on screen, so a selection
  // is scoped to the query that produced it: anything older reads as empty
  // rather than acting on rows nobody can see any more.
  const scope = [
    page,
    search,
    lifecycle,
    accessStatus,
    relation,
    roleFilter,
    sortBy,
    sortOrder,
    master?.id ?? "",
  ].join("\u0000")
  const [selection, setSelection] = useState<{ scope: string; ids: ReadonlySet<number> }>({
    scope,
    ids: NO_SELECTION,
  })
  const selected = selection.scope === scope ? selection.ids : NO_SELECTION
  const setSelected = (ids: ReadonlySet<number>) => setSelection({ scope, ids })
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
      sortOrder,
      master?.id ?? null,
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
          masterId: master?.id ?? null,
          sortBy,
          sortOrder,
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
  const stepUp = useStepUp(instance.id)
  const { confirm, dialog: confirmDialog } = useConfirm()
  const bulk = useMutation({
    mutationFn: async ({
      action: nextAction,
      accountIds,
    }: {
      action: BulkAction
      accountIds: number[]
    }) => {
      const draft = {
        batch_operation_id: operationId(),
        mode: "best_effort" as const,
        action: nextAction,
        account_ids: accountIds,
        reason: m.bulkReason[nextAction],
      }
      const preview = await data<{ preview_token: string }>(instance.id, {
        kind: "actionPreview",
        body: { action: "account_batch", payload: draft },
      })
      await stepUp.authorize(preview.preview_token)
      const body: AccountBatchBody = { ...draft, preview_token: preview.preview_token }
      return data<{ succeeded: number; failed: number }>(instance.id, {
        kind: "createAccountBatch",
        body,
      })
    },
    onSuccess: async (result) => {
      // Best effort can come back all failed; that is not a success to toast.
      const summary = m.bulkResult(result.succeeded, result.failed)
      if (result.failed === 0) toast.success(summary)
      else if (result.succeeded > 0) toast.warning(summary)
      else toast.error(summary)
      setSelection((current) => ({ ...current, ids: NO_SELECTION }))
      await invalidate()
    },
    onError: reportError,
  })
  const startBulk = async (nextAction: BulkAction) => {
    const accountIds = [...selected].sort((left, right) => left - right)
    // Archiving takes accounts out of the default list; say so before it goes
    // to the browser for approval rather than after.
    if (
      nextAction === "archive" &&
      !(await confirm({
        title: m.batchArchiveTitle(accountIds.length),
        description: m.batchArchiveBody,
        confirmLabel: m.batchArchive,
        cancelLabel: m.cancel,
        destructive: true,
      }))
    ) {
      return
    }
    bulk.mutate({ action: nextAction, accountIds })
  }
  const bulkLabel = (nextAction: BulkAction, label: string) =>
    stepUp.waiting && bulk.variables?.action === nextAction ? m.waitingForBrowser : label

  const viewChildren = (account: Account) => {
    setMaster({ id: account.id, username: account.username })
    setTree(false)
    setPage(1)
  }
  const sortColumn = (column: "username" | "quota") => {
    if (sortBy === column) setSortOrder((value) => (value === "asc" ? "desc" : "asc"))
    else {
      setSortBy(column)
      setSortOrder(column === "username" ? "asc" : "desc")
    }
    setPage(1)
  }

  const items = accounts.data?.items ?? []
  const total = accounts.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const lifecycleLabels: Record<string, string> = {
    active: m.active,
    closing: m.closing,
    archived: m.archived,
  }
  const accessLabels: Record<string, string> = { enabled: m.enabled, disabled: m.disabled }
  const relationLabels: Record<string, string> = { master: m.master, child: m.child }
  const roleLabels: Record<string, string> = {
    root: m.root,
    admin: m.admin,
    master: m.master,
    child: m.child,
  }
  const chips: AccountFilterChip[] = [
    search
      ? { key: "search", field: m.search, label: search, clear: () => setSearchInput("") }
      : null,
    lifecycle
      ? {
          key: "lifecycle",
          field: m.lifecycle,
          label: lifecycleLabels[lifecycle] ?? lifecycle,
          clear: () => {
            setLifecycle("")
            setPage(1)
          },
        }
      : null,
    accessStatus
      ? {
          key: "access",
          field: m.accessStatus,
          label: accessLabels[accessStatus] ?? accessStatus,
          clear: () => {
            setAccessStatus("")
            setPage(1)
          },
        }
      : null,
    relation
      ? {
          key: "relation",
          field: m.relationship,
          label: relationLabels[relation] ?? relation,
          clear: () => {
            setRelation("")
            setPage(1)
          },
        }
      : null,
    roleFilter
      ? {
          key: "role",
          field: m.role,
          label: roleLabels[roleFilter] ?? roleFilter,
          clear: () => {
            setRoleFilter("")
            setPage(1)
          },
        }
      : null,
    master
      ? {
          key: "master",
          label: m.childrenOf(master.username),
          clear: () => {
            setMaster(null)
            setPage(1)
          },
        }
      : null,
  ].filter((chip): chip is AccountFilterChip => chip !== null)
  const narrowedCount = [accessStatus, relation, roleFilter, master].filter(Boolean).length
  const clearAllFilters = () => {
    setSearchInput("")
    setLifecycle("")
    setAccessStatus("")
    setRelation("")
    setRoleFilter("")
    setMaster(null)
    setPage(1)
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="relative min-w-[11rem] flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={m.searchAccounts}
            aria-label={m.searchAccounts}
            className="pl-8"
          />
        </div>
        <FilterSelect
          id="accounts-lifecycle"
          label={m.lifecycle}
          hideLabel
          className="w-[11.5rem] shrink-0"
          value={lifecycle}
          onChange={(value) => {
            setLifecycle(value)
            setPage(1)
          }}
        >
          <option value="">{m.allStates}</option>
          <option value="active">{m.active}</option>
          <option value="closing">{m.closing}</option>
          <option value="archived">{m.archived}</option>
        </FilterSelect>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 shrink-0">
              <SlidersHorizontal className="size-4" />
              {m.filters}
              {narrowedCount ? (
                <span className="rounded-[var(--hm-radius-dot)] bg-primary px-1.5 text-xs font-medium tabular-nums text-primary-foreground">
                  {narrowedCount}
                </span>
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 space-y-3">
            <FilterSelect
              id="accounts-access"
              label={m.accessStatus}
              value={accessStatus}
              onChange={(value) => {
                setAccessStatus(value as typeof accessStatus)
                setPage(1)
              }}
            >
              <option value="">{m.allAccessStates}</option>
              <option value="enabled">{m.enabled}</option>
              <option value="disabled">{m.disabled}</option>
            </FilterSelect>
            <FilterSelect
              id="accounts-relation"
              label={m.relationship}
              value={relation}
              onChange={(value) => {
                setRelation(value as typeof relation)
                setPage(1)
              }}
            >
              <option value="">{m.allRelationships}</option>
              <option value="master">{m.master}</option>
              <option value="child">{m.child}</option>
            </FilterSelect>
            <FilterSelect
              id="accounts-role"
              label={m.role}
              value={roleFilter}
              onChange={(value) => {
                setRoleFilter(value as typeof roleFilter)
                setPage(1)
              }}
            >
              <option value="">{m.allRoles}</option>
              <option value="root">{m.root}</option>
              <option value="admin">{m.admin}</option>
              <option value="master">{m.master}</option>
              <option value="child">{m.child}</option>
            </FilterSelect>
            <FilterSelect
              id="accounts-sort"
              label={m.sortAccounts}
              value={sortBy}
              onChange={(value) => {
                setSortBy(value as typeof sortBy)
                setPage(1)
              }}
            >
              <option value="created_at">{m.newest}</option>
              <option value="username">{m.username}</option>
              <option value="quota">{m.balance}</option>
              <option value="last_login_at">{m.lastLogin}</option>
            </FilterSelect>
            <FilterSelect
              id="accounts-sort-order"
              label={m.sortOrder}
              value={sortOrder}
              onChange={(value) => {
                setSortOrder(value as typeof sortOrder)
                setPage(1)
              }}
            >
              <option value="desc">{m.descending}</option>
              <option value="asc">{m.ascending}</option>
            </FilterSelect>
          </PopoverContent>
        </Popover>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => setTree((value) => !value)}
          >
            <ListTree className="size-4" />
            {tree ? m.tableView : m.treeView}
          </Button>
          <Button
            size="sm"
            className="h-9"
            onClick={() => setCreateOpen(true)}
            disabled={!canWrite}
            title={canWrite ? undefined : instance.readOnly ? m.readonlyBanner : m.writeDenied}
          >
            <Plus className="size-4" />
            {m.createAccount}
          </Button>
        </div>
      </div>

      {chips.length ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.clear}
              aria-label={m.removeFilter(chip.field ? `${chip.field}: ${chip.label}` : chip.label)}
              className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-[var(--hm-radius-control)] border px-2 py-1 text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {chip.field ? (
                <span className="shrink-0 text-muted-foreground">{chip.field}</span>
              ) : null}
              <span className="truncate font-medium">{chip.label}</span>
              <X aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={clearAllFilters}>
            {m.clearFilters}
          </Button>
        </div>
      ) : null}

      <div className="min-w-0 overflow-hidden rounded-[var(--hm-radius-surface)] border">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2">
          {selected.size && canWrite ? (
            <>
              <span className="text-sm font-medium tabular-nums">{m.selected(selected.size)}</span>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={bulk.isPending}
                  onClick={() => void startBulk("enable")}
                >
                  {bulkLabel("enable", m.batchEnable)}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={bulk.isPending}
                  onClick={() => void startBulk("disable")}
                >
                  {bulkLabel("disable", m.batchDisable)}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={bulk.isPending}
                  onClick={() => void startBulk("archive")}
                >
                  {bulkLabel("archive", m.batchArchive)}
                </Button>
                {stepUp.waiting ? (
                  <Button variant="ghost" size="sm" onClick={stepUp.cancel}>
                    {m.cancelApproval}
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={bulk.isPending}
                    onClick={() => setSelected(new Set())}
                  >
                    {m.clearSelection}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <p className="text-xs tabular-nums text-muted-foreground">{m.accountsTotal(total)}</p>
          )}
          <div className="ml-auto flex min-w-0 items-center gap-3">
            {!canWrite && !instance.readOnly ? (
              <p className="text-xs text-muted-foreground">{m.writeDenied}</p>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={!items.length}
              title={items.length ? undefined : m.nothingToExport}
              onClick={() =>
                void saveCsv(
                  `more-token-accounts-${instance.id}-${page}.csv`,
                  accountsCsvRows(items),
                  { saved: m.csvSaved, failed: m.csvSaveFailed }
                )
              }
            >
              <Download className="size-4" />
              {m.exportAccounts}
            </Button>
          </div>
        </div>
        <div
          className={cn(
            accounts.isFetching &&
              !accounts.isLoading &&
              "opacity-60 transition-opacity duration-(--hm-dur-fast) ease-(--hm-ease-out)"
          )}
        >
          {accounts.isError ? (
            <div className="p-3">
              <ErrorPanel error={accounts.error} retry={() => void accounts.refetch()} />
            </div>
          ) : accounts.isLoading ? (
            <AccountsSkeleton />
          ) : tree ? (
            <div className="p-3">
              <Topology
                accounts={items}
                quotaDisplay={capabilities.quota_display}
                onSelect={(account) => setDetailId(account.id)}
                onViewChildren={viewChildren}
              />
            </div>
          ) : items.length === 0 ? (
            <div className="px-3 py-14 text-center">
              <p className="text-sm text-muted-foreground">{m.noData}</p>
              {chips.length ? (
                <Button variant="outline" size="sm" className="mt-3" onClick={clearAllFilters}>
                  {m.clearFilters}
                </Button>
              ) : null}
            </div>
          ) : (
            <AccountTable
              accounts={items}
              selectable={canWrite}
              selected={selected}
              setSelected={setSelected}
              onDetail={(account) => setDetailId(account.id)}
              onAction={(account, nextAction) => setAction({ account, action: nextAction })}
              onViewChildren={viewChildren}
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSort={sortColumn}
              capabilities={capabilities}
              readOnly={instance.readOnly}
              quotaDisplay={capabilities.quota_display}
            />
          )}
        </div>
      </div>

      <div className="flex min-w-0 items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="tabular-nums">{m.pageSummary(page, pages)}</span>
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
            disabled={page >= pages}
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
        open={detailId !== null}
        account={detailQuery.data?.account ?? null}
        error={detailQuery.isError ? detailQuery.error : null}
        onRetry={() => void detailQuery.refetch()}
        quotaDisplay={capabilities.quota_display}
        instance={instance}
        capabilities={capabilities}
        readOnly={instance.readOnly}
        onDone={invalidate}
        onAction={(account, nextAction) => setAction({ account, action: nextAction })}
        onViewChildren={(account) => {
          setDetailId(null)
          viewChildren(account)
        }}
        onOpenChange={(open) => !open && setDetailId(null)}
      />
      {confirmDialog}
    </div>
  )
}

function AccountTable({
  accounts,
  selectable,
  selected,
  setSelected,
  onDetail,
  onAction,
  onViewChildren,
  sortBy,
  sortOrder,
  onSort,
  capabilities,
  readOnly,
  quotaDisplay,
}: {
  accounts: Account[]
  /** Selection only feeds the bulk actions, so it exists only where they do. */
  selectable: boolean
  selected: ReadonlySet<number>
  setSelected: (value: ReadonlySet<number>) => void
  onDetail: (account: Account) => void
  onAction: (account: Account, action: AccountAction | "close") => void
  onViewChildren: (account: Account) => void
  sortBy: string
  sortOrder: "asc" | "desc"
  onSort: (column: "username" | "quota") => void
  capabilities: ManagementCapabilities
  readOnly: boolean
  quotaDisplay: QuotaDisplaySetting
}) {
  const m = useT().management
  const toggle = (account: Account, checked: boolean) => {
    const next = new Set(selected)
    if (checked) next.add(account.id)
    else next.delete(account.id)
    setSelected(next)
  }
  return (
    <>
      <div className="divide-y sm:hidden">
        {accounts.map((account) => (
          <article key={account.id} className="flex min-w-0 items-start gap-3 p-3">
            {selectable ? (
              <Checkbox
                className="mt-1 shrink-0"
                aria-label={account.username}
                checked={selected.has(account.id)}
                onCheckedChange={(value) => toggle(account, value === true)}
              />
            ) : null}
            <button className="min-w-0 flex-1 text-left" onClick={() => onDetail(account)}>
              <span className="block truncate font-medium">{account.username}</span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {account.display_name || `#${account.id}`}
              </span>
              <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <AccountStatusMark account={account} />
                <AccountRelationText account={account} />
                <AccountRoleBadge account={account} />
              </span>
              <AccountBalanceText
                value={account.quota}
                display={quotaDisplay}
                align="left"
                className="mt-2"
              />
            </button>
            <AccountActionsMenu
              account={account}
              capabilities={capabilities}
              readOnly={readOnly}
              onAction={onAction}
              extra={
                account.is_master && account.children_count
                  ? [
                      {
                        key: "children",
                        label: m.viewChildren,
                        onSelect: () => onViewChildren(account),
                      },
                    ]
                  : undefined
              }
            />
          </article>
        ))}
      </div>
      <div className="hidden sm:block">
        <Table>
          <TableHeader className="[&_th]:h-9 [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground">
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              {selectable ? (
                <TableHead className="w-10 pl-3">
                  <Checkbox
                    aria-label={m.all}
                    checked={accounts.length > 0 && selected.size === accounts.length}
                    onCheckedChange={(value) =>
                      setSelected(
                        value ? new Set(accounts.map((account) => account.id)) : new Set()
                      )
                    }
                  />
                </TableHead>
              ) : null}
              <SortableHead
                column="username"
                label={m.username}
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
                className={selectable ? undefined : "pl-3"}
              />
              <TableHead>{m.role}</TableHead>
              <TableHead>{m.relationship}</TableHead>
              <SortableHead
                column="quota"
                label={m.balance}
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
                className="text-right"
              />
              <TableHead>{m.status}</TableHead>
              <TableHead className="w-12 pr-3">
                <span className="sr-only">{m.actions}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((account) => (
              <TableRow
                key={account.id}
                data-state={selected.has(account.id) ? "selected" : undefined}
              >
                {selectable ? (
                  <TableCell className="pl-3">
                    <Checkbox
                      aria-label={account.username}
                      checked={selected.has(account.id)}
                      onCheckedChange={(value) => toggle(account, value === true)}
                    />
                  </TableCell>
                ) : null}
                <TableCell className={cn("py-2.5", !selectable && "pl-3")}>
                  <button
                    className="block min-w-0 max-w-[15rem] text-left"
                    onClick={() => onDetail(account)}
                  >
                    <span className="block truncate font-medium underline-offset-4 hover:underline">
                      {account.username}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {account.display_name || `#${account.id}`}
                    </span>
                  </button>
                </TableCell>
                <TableCell>
                  <AccountRoleBadge account={account} />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  <AccountRelationText account={account} onViewChildren={onViewChildren} />
                </TableCell>
                <TableCell>
                  <AccountBalanceText value={account.quota} display={quotaDisplay} />
                </TableCell>
                <TableCell className="text-sm">
                  <AccountStatusMark account={account} />
                </TableCell>
                <TableCell className="pr-3">
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
  const stepUp = useStepUp(instance.id)
  const mutation = useMutation({
    mutationFn: async (
      payload: Omit<import("@/lib/more-token/types").CreateAccountBody, "preview_token">
    ) => {
      const preview = await data<{ preview_token: string }>(instance.id, {
        kind: "actionPreview",
        body: { action: "create_account", payload },
      })
      await stepUp.authorize(preview.preview_token)
      return data<{ temporary_password?: string; credential_mode: string }>(instance.id, {
        kind: "createAccount",
        body: { ...payload, preview_token: preview.preview_token },
      })
    },
    onSuccess: (result) => {
      onDone()
      if (result.temporary_password) setTemporaryPassword(result.temporary_password)
      else close()
    },
    onError: reportError,
  })
  // The dialog stays mounted between openings. A temporary password is shown
  // once, so it must not outlive the dialog: left in state, reopening showed it
  // again and turned Create into a button that could only close.
  function close() {
    stepUp.cancel()
    setTemporaryPassword(null)
    mutation.reset()
    onOpenChange(false)
  }
  const invitesEnabled = capabilities.features.account_invites_enabled
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
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
              invite_by_email: invitesEnabled && form.get("invite_by_email") === "on",
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
            <fieldset
              disabled={temporaryPassword !== null || mutation.isPending}
              className="grid min-w-0 gap-4"
            >
              <Field name="username" label={m.username} required />
              <Field name="display_name" label={m.displayName} />
              <Field name="email" label={m.email} type="email" />
              <Field name="group" label={m.group} defaultValue="default" required />
              <Field name="master_id" label={m.masterId} type="number" min={0} />
              <Field name="initial_quota" label={m.initialQuota} type="number" min={0} />
              <Field name="reason" label={m.reason} required />
              <div>
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <Checkbox name="invite_by_email" disabled={!invitesEnabled} />
                  {m.sendInvitationEmail}
                </label>
                {invitesEnabled ? null : (
                  <p className="text-xs text-muted-foreground">{m.invitesDisabled}</p>
                )}
              </div>
            </fieldset>
          </div>
          <DialogFooter>
            {temporaryPassword ? null : (
              <Button type="button" variant="outline" onClick={close}>
                {m.cancel}
              </Button>
            )}
            <Button
              type={temporaryPassword ? "button" : "submit"}
              disabled={!temporaryPassword && mutation.isPending}
              onClick={temporaryPassword ? close : undefined}
            >
              {temporaryPassword
                ? m.confirm
                : stepUp.waiting
                  ? m.waitingForBrowser
                  : m.createAccount}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type AccountActionPayload = Omit<AccountActionBody, "preview_token"> & { account_id: number }

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
  const [previewPayload, setPreviewPayload] = useState<AccountActionPayload | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const stepUp = useStepUp(instance.id)
  const previewMutation = useMutation({
    mutationFn: async (payload: AccountActionPayload) =>
      data<typeof preview extends null ? never : NonNullable<typeof preview>>(instance.id, {
        kind: "actionPreview",
        body: { action: state?.action ?? "", payload },
      }),
    onSuccess: setPreview,
    onError: reportError,
  })
  const commitMutation = useMutation({
    mutationFn: async ({ payload, token }: { payload: AccountActionPayload; token: string }) => {
      await stepUp.authorize(token)
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
      close()
      onDone()
    },
    onError: (error) => {
      if (isStepUpCancelled(error)) return
      if (error instanceof ManagementApiError && error.code === "VERSION_CONFLICT") {
        // The preview is stale; back to the form so a fresh one can be taken.
        editPayload()
        toast.error(m.versionConflict)
        return
      }
      toast.error(errorText(error))
    },
  })
  // The dialog stays mounted between openings, so every way out — Cancel, Esc,
  // the overlay, a completed write — goes through here. Anything left behind
  // greeted the next account: its preview, and a Confirm that sent the old
  // payload with a token the server had already spent.
  function close() {
    stepUp.cancel()
    setPreview(null)
    setPreviewPayload(null)
    previewMutation.reset()
    commitMutation.reset()
    onOpenChange(false)
  }
  // A preview certifies one payload. The fields lock while it stands, and
  // changing them means dropping it and previewing again.
  function editPayload() {
    setPreview(null)
    setPreviewPayload(null)
  }
  if (!state) return null
  const buildPayload = (): AccountActionPayload => {
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
  const busy = previewMutation.isPending || commitMutation.isPending
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent>
        <form
          ref={formRef}
          onSubmit={(event) => {
            event.preventDefault()
            if (preview && previewPayload) {
              commitMutation.mutate({ payload: previewPayload, token: preview.preview_token })
              return
            }
            const payload = buildPayload()
            setPreviewPayload(payload)
            previewMutation.mutate(payload)
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
            <fieldset disabled={preview !== null || busy} className="min-w-0 space-y-4">
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
            </fieldset>
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
            <Button type="button" variant="outline" onClick={close}>
              {m.cancel}
            </Button>
            {preview ? (
              <Button
                type="button"
                variant="ghost"
                onClick={editPayload}
                disabled={commitMutation.isPending}
              >
                {m.edit}
              </Button>
            ) : null}
            <Button
              type="submit"
              variant={state.action === "close" ? "destructive" : "default"}
              disabled={busy}
            >
              {preview
                ? stepUp.waiting
                  ? m.waitingForBrowser
                  : m.confirm
                : previewMutation.isPending
                  ? m.previewing
                  : m.preview}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, ...props }: React.ComponentProps<typeof Input> & { label: string }) {
  // Several forms share field names ("reason" is in the policy editor and in
  // every dialog over it), so a name-derived id would point a dialog's label at
  // the page's input instead.
  const id = useId()
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
  const transferScoped = capabilities.scopes.includes("quota:transfer")
  const canTransfer =
    !instance.readOnly && capabilities.features.quota_transfer_enabled && transferScoped
  // Read-only and a server-closed feature each already say so in a banner
  // above; a missing scope is the one reason nothing else on the page states.
  const transferDenied =
    !instance.readOnly && capabilities.features.quota_transfer_enabled && !transferScoped
  const ledgerItems = ledger.data?.items ?? []
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {transferDenied ? (
          <p className="mr-auto text-xs text-muted-foreground">{m.transferScopeDenied}</p>
        ) : null}
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
      {summary.isError ? (
        <ErrorPanel error={summary.error} retry={() => void summary.refetch()} />
      ) : summary.isLoading ? (
        <Skeleton className="h-20" aria-busy="true" />
      ) : (
        // Sized by the panel (see SummaryCell): at a 1100px window the window-
        // wide `lg` step set four composite amounts in ~140px cells each, and
        // "CNY 610.0462 · 305,023,119 quota" broke across five lines.
        <div className="@container">
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border @2xl:grid-cols-4">
            <SummaryCell
              label={m.totalQuota}
              value={
                summary.data
                  ? quotaAmountWithRaw(summary.data.available, capabilities.quota_display)
                  : "—"
              }
            />
            <SummaryCell
              label={m.usedQuota}
              value={
                summary.data
                  ? quotaAmountWithRaw(summary.data.used, capabilities.quota_display)
                  : "—"
              }
            />
            <SummaryCell
              label={m.accounts}
              value={summary.data ? number(summary.data.accounts) : "—"}
            />
            <SummaryCell
              label={m.quotaTotal}
              value={
                summary.data
                  ? quotaAmountWithRaw(summary.data.total, capabilities.quota_display)
                  : "—"
              }
            />
          </dl>
        </div>
      )}
      <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1.25fr)_minmax(310px,0.75fr)]">
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
                disabled={!ledgerItems.length}
                title={ledgerItems.length ? undefined : m.nothingToExport}
                onClick={() =>
                  void saveCsv(
                    `more-token-ledger-${instance.id}-${ledgerPage}.csv`,
                    quotaTransactionsCsvRows(ledgerItems),
                    { saved: m.csvSaved, failed: m.csvSaveFailed }
                  )
                }
              >
                <Download className="size-4" />
                {m.exportLedgerPage}
              </Button>
            </div>
          </div>
          <div className="min-w-0 overflow-x-auto">
            {ledger.isError ? (
              <ErrorPanel error={ledger.error} retry={() => void ledger.refetch()} />
            ) : ledger.isLoading ? (
              <AccountsSkeleton />
            ) : (
              <LedgerTable
                items={ledgerItems}
                instance={instance}
                capabilities={capabilities}
                onDone={invalidate}
              />
            )}
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
          error={policy.isError ? policy.error : null}
          retry={() => void policy.refetch()}
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
  const stepUp = useStepUp(instance.id)
  const { confirm, dialog: confirmDialog } = useConfirm()
  const reverse = useMutation({
    mutationFn: async (transaction: QuotaTransaction) => {
      const op = operationId()
      const reason = m.reverseReason(transaction.id)
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
      await stepUp.authorize(preview.preview_token)
      return data(instance.id, {
        kind: "reverseQuota",
        id: transaction.id,
        body: { operation_id: op, reason, preview_token: preview.preview_token },
      })
    },
    onSuccess: onDone,
    onError: reportError,
  })
  // A reversal moves quota back between two accounts. The browser approval
  // that follows names neither, so the app says what it is about to ask for.
  const requestReverse = async (transaction: QuotaTransaction) => {
    const confirmed = await confirm({
      title: m.reverseTitle(transaction.id),
      description: m.reverseBody(
        quotaAmountWithRaw(transaction.amount, capabilities.quota_display),
        transaction.target_id,
        transaction.source_id
      ),
      confirmLabel: m.reverse,
      cancelLabel: m.cancel,
      destructive: true,
    })
    if (confirmed) reverse.mutate(transaction)
  }
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
          {items.map((item) => {
            const waiting = stepUp.waiting && reverse.variables?.id === item.id
            return (
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
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void requestReverse(item)}
                        disabled={reverse.isPending || instance.readOnly}
                      >
                        {waiting ? m.waitingForBrowser : m.reverse}
                      </Button>
                      {waiting ? (
                        <Button variant="ghost" size="sm" onClick={stepUp.cancel}>
                          {m.cancelApproval}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            )
          })}
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                {m.noData}
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
      {confirmDialog}
    </div>
  )
}

type TransferPayload = Omit<QuotaTransferBody, "preview_token">

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
  const [preview, setPreview] = useState<{
    preview_token: string
    impact: Array<{ id: number; quota: number }>
  } | null>(null)
  const [previewPayload, setPreviewPayload] = useState<TransferPayload | null>(null)
  const stepUp = useStepUp(instance.id)
  const previewMutation = useMutation({
    mutationFn: (payload: TransferPayload) =>
      data<{ preview_token: string; impact: Array<{ id: number; quota: number }> }>(instance.id, {
        kind: "actionPreview",
        body: { action: "quota_transfer", payload },
      }),
    onSuccess: setPreview,
    onError: reportError,
  })
  const commitMutation = useMutation({
    mutationFn: async ({ payload, token }: { payload: TransferPayload; token: string }) => {
      await stepUp.authorize(token)
      return data(instance.id, {
        kind: "quotaTransfer",
        body: { ...payload, preview_token: token },
      })
    },
    onSuccess: () => {
      close()
      onDone()
    },
    onError: reportError,
  })
  // Every way out resets. The dialog stays mounted, so a preview left behind
  // reappeared on the next opening and Confirm re-sent its payload with a
  // token the server had already spent.
  function close() {
    stepUp.cancel()
    setPreview(null)
    setPreviewPayload(null)
    previewMutation.reset()
    commitMutation.reset()
    onOpenChange(false)
  }
  function editPayload() {
    setPreview(null)
    setPreviewPayload(null)
  }
  const busy = previewMutation.isPending || commitMutation.isPending
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (preview && previewPayload) {
              commitMutation.mutate({ payload: previewPayload, token: preview.preview_token })
              return
            }
            const form = new FormData(event.currentTarget)
            const payload = {
              operation_id: operationId(),
              source_id: Number(form.get("source_id")),
              target_id: Number(form.get("target_id")),
              amount: Number(form.get("amount")),
              reason: String(form.get("reason")),
            }
            setPreviewPayload(payload)
            previewMutation.mutate(payload)
          }}
        >
          <DialogHeader>
            <DialogTitle>{m.transfer}</DialogTitle>
            <DialogDescription>{m.reasonHint}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4 sm:grid-cols-2">
            <fieldset
              disabled={preview !== null || busy}
              className="grid min-w-0 gap-4 sm:col-span-2 sm:grid-cols-2"
            >
              <Field name="source_id" label={m.sourceId} type="number" min={1} required />
              <Field name="target_id" label={m.targetId} type="number" min={1} required />
              <Field name="amount" label={m.amount} type="number" min={1} required />
              <Field name="reason" label={m.reason} required />
            </fieldset>
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
            <Button type="button" variant="outline" onClick={close}>
              {m.cancel}
            </Button>
            {preview ? (
              <Button
                type="button"
                variant="ghost"
                onClick={editPayload}
                disabled={commitMutation.isPending}
              >
                {m.edit}
              </Button>
            ) : null}
            <Button type="submit" disabled={busy}>
              {preview
                ? stepUp.waiting
                  ? m.waitingForBrowser
                  : m.confirm
                : previewMutation.isPending
                  ? m.previewing
                  : m.preview}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type BatchPayload = Omit<QuotaBatchBody, "preview_token">

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
  const [payload, setPayload] = useState<BatchPayload | null>(null)
  const [batchId, setBatchId] = useState<number | null>(null)
  const stepUp = useStepUp(instance.id)
  const batch = useQuery({
    queryKey: ["more-token", instance.id, "quota-batch", batchId],
    // Progress is only polled while someone is looking at it.
    enabled: open && batchId !== null,
    queryFn: () =>
      data<{
        batch: { id: number; status: string }
        items: Array<{ item_key: string; status: string; error_code?: string }>
      }>(instance.id, { kind: "quotaBatch", id: batchId! }),
    refetchInterval: 2_000,
  })
  const previewMutation = useMutation({
    mutationFn: async (form: HTMLFormElement) => {
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
      const next: BatchPayload = {
        batch_operation_id: operationId(),
        mode: fields.get("mode") === "best_effort" ? "best_effort" : "atomic",
        items,
      }
      const result = await data<{ preview_token: string }>(instance.id, {
        kind: "actionPreview",
        body: { action: "quota_batch", payload: next },
      })
      return { next, token: result.preview_token }
    },
    onSuccess: ({ next, token }) => {
      setPayload(next)
      setPreview(token)
    },
    onError: reportError,
  })
  const commitMutation = useMutation({
    mutationFn: async ({ body, token }: { body: BatchPayload; token: string }) => {
      await stepUp.authorize(token)
      return data<{ id: number; status: string }>(instance.id, {
        kind: "createQuotaBatch",
        body: { ...body, preview_token: token },
      })
    },
    onSuccess: (result) => {
      // The token is spent. What is left to do in this dialog is watch it run.
      setPreview(null)
      setBatchId(result.id)
      onDone()
    },
    onError: reportError,
  })
  // Every way out resets, which is also what stops the progress poll.
  function close() {
    stepUp.cancel()
    setPreview(null)
    setPayload(null)
    setBatchId(null)
    previewMutation.reset()
    commitMutation.reset()
    onOpenChange(false)
  }
  function editPayload() {
    setPreview(null)
    setPayload(null)
  }
  const busy = previewMutation.isPending || commitMutation.isPending
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (preview && payload) commitMutation.mutate({ body: payload, token: preview })
            else previewMutation.mutate(event.currentTarget)
          }}
        >
          <DialogHeader>
            <DialogTitle>{m.batchTransfer}</DialogTitle>
            <DialogDescription>{m.batchItemsHint}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <fieldset
              disabled={preview !== null || batchId !== null || busy}
              className="min-w-0 space-y-4"
            >
              <select
                name="mode"
                aria-label={m.batchTransfer}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
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
            </fieldset>
            {batch.isError ? (
              <ErrorPanel error={batch.error} retry={() => void batch.refetch()} />
            ) : null}
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
                <AlertDescription>{m.batchItemCount(payload?.items.length ?? 0)}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter>
            {batchId !== null ? (
              <Button type="button" onClick={close}>
                {m.done}
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={close}>
                  {m.cancel}
                </Button>
                {preview ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={editPayload}
                    disabled={commitMutation.isPending}
                  >
                    {m.edit}
                  </Button>
                ) : null}
                <Button type="submit" disabled={busy}>
                  {preview
                    ? stepUp.waiting
                      ? m.waitingForBrowser
                      : m.submitBatch
                    : previewMutation.isPending
                      ? m.previewing
                      : m.preview}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PolicyEditor({
  policy,
  error,
  retry,
  instance,
  capabilities,
  onDone,
}: {
  policy: QuotaPolicy | null
  error: unknown
  retry: () => void
  instance: MoreTokenInstance
  capabilities: ManagementCapabilities
  onDone: () => void
}) {
  const m = useT().management
  const stepUp = useStepUp(instance.id)
  const mutation = useMutation({
    mutationFn: async (draft: QuotaPolicy & { reason: string }) => {
      const payload = { account_id: draft.master_id, ...draft }
      const preview = await data<{ preview_token: string }>(instance.id, {
        kind: "actionPreview",
        body: { action: "quota_policy_update", payload },
      })
      await stepUp.authorize(preview.preview_token)
      const body: UpdateQuotaPolicyBody = { ...draft, preview_token: preview.preview_token }
      return data(instance.id, { kind: "updateQuotaPolicy", body })
    },
    onSuccess: onDone,
    onError: reportError,
  })
  if (error)
    return (
      <section className="border-y py-4">
        <h3 className="font-medium">{m.policies}</h3>
        <div className="mt-4">
          <ErrorPanel error={error} retry={retry} />
        </div>
      </section>
    )
  if (!policy)
    return (
      <section className="border-y p-5" aria-busy="true">
        <Skeleton className="h-64" />
      </section>
    )
  const scoped = capabilities.scopes.includes("policy:write")
  const canWrite = scoped && !instance.readOnly
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
          {/* Outline: Transfer is this view's one primary action. */}
          <Button
            type="submit"
            variant="outline"
            className="w-full"
            disabled={!canWrite || mutation.isPending}
          >
            {stepUp.waiting ? m.waitingForBrowser : m.savePolicy}
          </Button>
          {stepUp.waiting ? (
            <Button type="button" variant="ghost" className="w-full" onClick={stepUp.cancel}>
              {m.cancelApproval}
            </Button>
          ) : null}
          {canWrite ? null : (
            <p className="text-xs text-muted-foreground">
              {instance.readOnly ? m.readonlyBanner : m.policyWriteDenied}
            </p>
          )}
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
    const rows: Array<Array<string | number>> = [
      [m.analyticsDefinition],
      [m.instance, instance.name],
      [m.timezone, analytics.data.timezone],
      [m.generatedAt, formatTime(analytics.data.generated_at)],
      [m.from, formatTime(start)],
      [m.to, formatTime(end)],
      [],
      ["bucket", "rpm", "tpm", "quota"],
      ...analytics.data.series.map((point) => [point.bucket, point.rpm, point.tpm, point.quota]),
    ]
    void saveCsv(`more-token-usage-${instance.id}-${analytics.data.generated_at}.csv`, rows, {
      saved: m.csvSaved,
      failed: m.csvSaveFailed,
    })
  }
  // Column counts follow this panel, not the window. At a 1100px window the
  // window-wide `lg` step packed six fields into ~550px: the dates read "09/01"
  // and the status select "Succes".
  return (
    <div className="@container space-y-5">
      <div className="grid gap-3 rounded-md border p-3 @sm:grid-cols-2 @3xl:grid-cols-3 @6xl:grid-cols-6">
        <FieldValue label={m.from}>
          {/* Local wall-clock both ways (see lib/more-token/datetime). A cleared
              segment reads as no value and is ignored, not turned into NaN. */}
          <Input
            type="datetime-local"
            value={toLocalDateTimeInput(start)}
            onChange={(event) => {
              const next = parseLocalDateTimeInput(event.target.value)
              if (next !== null) setStart(next)
            }}
          />
        </FieldValue>
        <FieldValue label={m.to}>
          <Input
            type="datetime-local"
            value={toLocalDateTimeInput(end)}
            onChange={(event) => {
              const next = parseLocalDateTimeInput(event.target.value)
              if (next !== null) setEnd(next)
            }}
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
      {analytics.isError ? (
        <ErrorPanel error={analytics.error} retry={() => void analytics.refetch()} />
      ) : null}
      <div className="grid overflow-hidden rounded-lg border @3xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
        <section className="min-w-0 p-5 @3xl:border-r">
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
        <section className="border-t p-5 @3xl:border-t-0">
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
          {analytics.isLoading ? (
            <Skeleton className="h-44" />
          ) : (
            <UsageBars series={analytics.data?.series ?? []} />
          )}
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
  const { confirm, dialog: confirmDialog } = useConfirm()
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
    <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
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
          {audits.isError ? (
            <ErrorPanel error={audits.error} retry={() => void audits.refetch()} />
          ) : audits.isLoading ? (
            <Skeleton className="h-40" />
          ) : !audits.data?.items.length ? (
            <p className="text-sm text-muted-foreground">{m.noData}</p>
          ) : null}
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
            {rules.isError ? (
              <ErrorPanel error={rules.error} retry={() => void rules.refetch()} />
            ) : rules.isLoading ? (
              <Skeleton className="h-16" />
            ) : rules.data?.items.length ? (
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
                      onClick={async () => {
                        const confirmed = await confirm({
                          title: m.deleteRuleTitle(rule.name),
                          description: m.deleteRuleBody,
                          confirmLabel: m.delete,
                          cancelLabel: m.cancel,
                          destructive: true,
                        })
                        if (confirmed) deleteRule.mutate(rule.id)
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
            {events.isError ? (
              <ErrorPanel error={events.error} retry={() => void events.refetch()} />
            ) : events.isLoading ? (
              <Skeleton className="h-16" />
            ) : !events.data?.items.length ? (
              <p className="text-sm text-muted-foreground">{m.noData}</p>
            ) : null}
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
        open={detailId !== null}
        account={detail.data?.account ?? null}
        error={detail.isError ? detail.error : null}
        onRetry={() => void detail.refetch()}
        quotaDisplay={capabilities.quota_display}
        instance={instance}
        capabilities={capabilities}
        onDone={() => queryClient.invalidateQueries({ queryKey: ["more-token", instance.id] })}
        onOpenChange={(open) => !open && setDetailId(null)}
      />
      {confirmDialog}
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
              // The dialog has no switch for this; the row does. Editing a
              // rule's threshold must not quietly switch a disabled rule back on.
              enabled: rule?.enabled ?? true,
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
