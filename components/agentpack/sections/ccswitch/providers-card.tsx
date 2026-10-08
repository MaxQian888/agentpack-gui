/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 */
/* Hallmark · genre: modern-minimal · macrostructure: one table, one toolbar, one primary · theme: inherited Cobalt · contrast: pass · slop: pass · mobile: pass */
"use client"

import { useMemo } from "react"
import { AlertTriangle, Download, Loader2, Plus, Power, RefreshCw, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { isOfficial } from "@/lib/agentpack/ccswitch/official"
import { parseSettingsConfig } from "@/lib/agentpack/ccswitch/provider"
import type { UnmanagedProvider } from "@/lib/agentpack/ccswitch/import"
import {
  PROVIDER_APPS,
  type Provider,
  type ProviderApp,
  type ProviderForm as ProviderFormData,
} from "@/lib/agentpack/ccswitch/types"
import { isTauri } from "@/lib/tauri"
import { useT } from "@/lib/i18n/provider"
import { LoadingLine } from "./loading-line"

export type ProviderStatusFilter = "all" | "official" | "custom" | "current"
export type ProviderSortKey = "name" | "app" | "current"

export interface ProviderFilters {
  query: string
  app: ProviderApp | "all"
  status: ProviderStatusFilter
  sort: ProviderSortKey
}

/**
 * The provider list — the thing this whole section exists to manage, and now
 * the panel that reads like it.
 *
 * Three changes carry the weight. The **toolbar** (search, two filters, a sort)
 * only renders once there is a list to filter: four full-width controls above
 * the words "no providers yet" was chrome describing nothing. The **endpoint**
 * is a column, because "which relay is this?" is the question a row is actually
 * asked, and it was previously answerable only by opening the edit form. And
 * the **empty state** says what to do next instead of stopping at a full stop.
 *
 * Row actions stay as labelled buttons rather than folding into a ⋯ menu:
 * hiding "Set as current" behind a menu saves one row of pixels and costs a
 * first-time user the one verb the page is about.
 */
export function ProvidersCard({
  providers,
  loading,
  unmanaged,
  editingBlocked,
  addBlockedReason,
  unavailable,
  tauri,
  hasCurrent,
  filters,
  appBusy,
  quickAdd,
  onFilters,
  onAdd,
  onEdit,
  onSetCurrent,
  onDelete,
  onSync,
  onExport,
  onImport,
  onQuitApp,
  onRefresh,
}: {
  providers: Provider[] | null
  loading: boolean
  unmanaged: readonly UnmanagedProvider[]
  editingBlocked: boolean
  /** Why no row can be added yet (no database, or one too old to write). */
  addBlockedReason?: string
  /** Why there is no list at all, when `providers` is null after a scan. */
  unavailable?: string
  tauri: boolean
  hasCurrent: boolean
  filters: ProviderFilters
  appBusy: "open" | "quit" | null
  /** Rendered in the empty state, where a first provider is actually chosen. */
  quickAdd?: React.ReactNode
  onFilters: (next: Partial<ProviderFilters>) => void
  onAdd: (initial?: Partial<ProviderFormData>) => void
  onEdit: (provider: Provider) => void
  onSetCurrent: (provider: Provider) => void
  onDelete: (provider: Provider) => void
  onSync: () => void
  onExport: (withTokens: boolean) => void
  onImport: () => void
  onQuitApp: () => void
  onRefresh: () => void
}) {
  const t = useT()
  const c = t.ccswitch

  const filtered = useMemo(() => {
    const query = filters.query.trim().toLocaleLowerCase()
    return [...(providers ?? [])]
      .filter((provider) => {
        if (query && !provider.name.toLocaleLowerCase().includes(query)) return false
        if (filters.app !== "all" && provider.app_type !== filters.app) return false
        if (filters.status === "official" && !isOfficial(provider)) return false
        if (filters.status === "custom" && isOfficial(provider)) return false
        if (filters.status === "current" && !provider.is_current) return false
        return true
      })
      .sort((a, b) => {
        if (filters.sort === "current" && a.is_current !== b.is_current) {
          return a.is_current ? -1 : 1
        }
        const fieldA = filters.sort === "app" ? a.app_type : a.name
        const fieldB = filters.sort === "app" ? b.app_type : b.name
        return fieldA.localeCompare(fieldB)
      })
  }, [filters, providers])

  const hasList = !!providers && providers.length > 0

  return (
    <section aria-label={c.providersTitle} className="flex min-w-0 flex-col rounded-lg border">
      {/* Heading row: what this is, how many, and the one primary button on the
          page. Export/Import sit under it as quiet verbs — they are chores, not
          the reason anyone opened this section. */}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h3 className="font-medium">{c.providersTitle}</h3>
          {providers ? (
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {c.providersCount(providers.length)}
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                disabled={!hasList}
              >
                {c.exportProviders}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{c.exportProviders}</AlertDialogTitle>
                <AlertDialogDescription>{c.exportTokensAsk}</AlertDialogDescription>
              </AlertDialogHeader>
              {/* One primary, and it is the file that is safe to share. The
                  one carrying tokens is a credential file and must not look
                  like the default. */}
              <AlertDialogFooter>
                <AlertDialogCancel>{t.shell.cancel}</AlertDialogCancel>
                <AlertDialogAction variant="outline" onClick={() => onExport(true)}>
                  {c.exportWithTokens}
                </AlertDialogAction>
                <AlertDialogAction onClick={() => onExport(false)}>
                  {c.exportWithoutTokens}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={editingBlocked || !tauri || !!addBlockedReason}
            aria-describedby={addBlockedReason ? "ccswitch-add-blocked" : undefined}
            onClick={onImport}
          >
            {c.importProviders}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onSync}
            disabled={!hasCurrent || editingBlocked}
          >
            {c.syncCurrent}
          </Button>
          <Button
            size="sm"
            className="gap-1"
            disabled={editingBlocked || !tauri || !!addBlockedReason}
            aria-describedby={addBlockedReason ? "ccswitch-add-blocked" : undefined}
            onClick={() => onAdd()}
          >
            <Plus className="size-4" />
            {c.addProvider}
          </Button>
        </div>
        {/* A disabled Add says why, where the button is. */}
        {addBlockedReason && tauri ? (
          <p
            id="ccswitch-add-blocked"
            className="min-w-0 basis-full text-xs leading-relaxed text-muted-foreground"
          >
            {addBlockedReason}
          </p>
        ) : null}
      </div>

      {/* Everything that blocks or complicates editing, stated once, above the
          list it applies to. */}
      {editingBlocked || (unmanaged.length > 0 && !editingBlocked) ? (
        <div className="min-w-0 space-y-2 border-t px-4 py-3">
          {editingBlocked ? (
            <Alert>
              <AlertTriangle />
              <AlertTitle>{c.runningTitle}</AlertTitle>
              <AlertDescription>
                <span>{c.runningHint}</span>
                {/* The fix, right where the problem is stated — no hunting for the
                    app in the dock just to unblock editing here. */}
                <div className="mt-1 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={onQuitApp}
                    disabled={appBusy !== null}
                  >
                    {appBusy === "quit" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Power className="size-3.5" />
                    )}
                    {c.appQuit}
                  </Button>
                  <Button variant="ghost" size="sm" className="gap-1" onClick={onRefresh}>
                    <RefreshCw className="size-3.5" />
                    {c.refresh}
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : null}

          {unmanaged.length > 0 && !editingBlocked ? (
            <Alert>
              <Download />
              <AlertTitle>{c.unmanagedTitle(unmanaged.length)}</AlertTitle>
              <AlertDescription>
                <span>{c.unmanagedHint}</span>
                <div className="mt-1 flex flex-wrap gap-2">
                  {unmanaged.map((entry) => (
                    <Button
                      key={entry.key}
                      variant="outline"
                      size="sm"
                      onClick={() => onAdd(entry.form)}
                    >
                      {c.importOne(entry.app, entry.form.baseUrl ?? "")}
                    </Button>
                  ))}
                </div>
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : null}

      {/* Filters exist only once there is something to filter. */}
      {hasList ? (
        <div
          role="group"
          aria-label={c.providerToolbarLabel}
          className="flex min-w-0 flex-wrap items-center gap-2 border-t bg-[var(--hm-paper-2)] px-4 py-2"
        >
          <div className="relative min-w-0 flex-1 basis-48">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filters.query}
              onChange={(event) => onFilters({ query: event.target.value })}
              placeholder={c.providerSearch}
              className="h-8 bg-background pl-8"
            />
          </div>
          <Select value={filters.app} onValueChange={(value) => onFilters({ app: value as never })}>
            <SelectTrigger size="sm" aria-label={c.providerAppFilter} className="bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{c.providerAllApps}</SelectItem>
              {PROVIDER_APPS.map((app) => (
                <SelectItem key={app} value={app}>
                  {c.appLabels[app] ?? app}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.status}
            onValueChange={(value) => onFilters({ status: value as ProviderStatusFilter })}
          >
            <SelectTrigger size="sm" aria-label={c.providerStatusFilter} className="bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{c.providerStatusAll}</SelectItem>
              <SelectItem value="official">{c.providerStatusOfficial}</SelectItem>
              <SelectItem value="custom">{c.providerStatusCustom}</SelectItem>
              <SelectItem value="current">{c.providerStatusCurrent}</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={filters.sort}
            onValueChange={(value) => onFilters({ sort: value as ProviderSortKey })}
          >
            <SelectTrigger size="sm" aria-label={c.providerSort} className="bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">{c.providerSortName}</SelectItem>
              <SelectItem value="app">{c.providerSortApp}</SelectItem>
              <SelectItem value="current">{c.providerSortCurrent}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="min-w-0 border-t">
        {providers && filtered.length > 0 ? (
          <Table className="[&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
            <TableHeader>
              <TableRow>
                <TableHead>{c.fieldName.replace(":", "")}</TableHead>
                <TableHead>{c.fieldApp}</TableHead>
                <TableHead>{c.columnEndpoint}</TableHead>
                <TableHead className="text-right">{c.columnActions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((provider) => (
                <ProviderRow
                  key={provider.id}
                  provider={provider}
                  editingBlocked={editingBlocked}
                  onEdit={onEdit}
                  onSetCurrent={onSetCurrent}
                  onDelete={onDelete}
                />
              ))}
            </TableBody>
          </Table>
        ) : providers && providers.length > 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {c.providerFilterEmpty}
          </p>
        ) : loading && providers === null ? (
          <div className="px-4 py-3">
            <LoadingLine />
          </div>
        ) : (
          /* The empty state is where a first provider gets chosen, so the
             pre-filled ways in live here rather than three panels away. */
          <div className="min-w-0 px-4 py-5">
            {/* In web mode the section already carries one desktop-only note at
                the top of this column; a second one here is the same sentence
                twice in one eyeful. */}
            {/* No list is not the same as an empty one: it is a database too old
                to read, or a read that failed, and the sentence says which.
                (It used to say "database not found" for both, on the native
                store too, which has no database at all.) */}
            {providers || isTauri() ? (
              <p className="text-sm font-medium">
                {providers ? c.empty : (unavailable ?? c.loadFailed)}
              </p>
            ) : null}
            {providers ? (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.emptyHint}</p>
            ) : null}
            {quickAdd ? (
              <div className="mt-3 min-w-0 border-t pt-3 first:mt-0 first:border-t-0 first:pt-0">
                {quickAdd}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* The consequence of the verb above, stated once at the foot of the list
          it applies to — not repeated per row. */}
      <p
        id="ccswitch-list-note"
        className="min-w-0 border-t px-4 py-2.5 text-xs leading-relaxed text-muted-foreground"
      >
        {hasCurrent ? c.setCurrentNote : c.syncNoCurrent}
        {/* The reason the current row's Delete is disabled, said once here
            rather than hidden in a tooltip a disabled button never shows. */}
        {hasCurrent ? ` ${c.deleteCurrentBlocked}` : null}
      </p>
    </section>
  )
}

function ProviderRow({
  provider,
  editingBlocked,
  onEdit,
  onSetCurrent,
  onDelete,
}: {
  provider: Provider
  editingBlocked: boolean
  onEdit: (provider: Provider) => void
  onSetCurrent: (provider: Provider) => void
  onDelete: (provider: Provider) => void
}) {
  const t = useT()
  const c = t.ccswitch
  const { baseUrl } = parseSettingsConfig(provider.app_type, provider.settings_config)

  return (
    <TableRow data-current={provider.is_current ? "true" : "false"}>
      <TableCell className="font-medium">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 [overflow-wrap:anywhere]">{provider.name}</span>
          {isOfficial(provider) ? (
            <Badge variant="outline" className="font-normal text-muted-foreground">
              {c.officialBadge}
            </Badge>
          ) : null}
          {provider.is_current ? (
            <Badge variant="secondary" className="gap-1 font-normal">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-[var(--hm-radius-dot)] bg-[var(--hm-ok)]"
              />
              {c.current}
            </Badge>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground capitalize">
        {c.appLabels[provider.app_type] ?? provider.app_type}
      </TableCell>
      <TableCell className="max-w-[18rem] min-w-0">
        <span className="block truncate font-mono text-[var(--hm-text-2xs)] text-muted-foreground">
          {baseUrl || "—"}
        </span>
      </TableCell>
      <TableCell className="space-x-1 text-right whitespace-nowrap">
        <Button
          variant="ghost"
          size="sm"
          disabled={editingBlocked}
          onClick={() => onEdit(provider)}
        >
          {c.rowActionEdit}
        </Button>
        {!provider.is_current ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={editingBlocked}>
                {c.rowActionSetCurrent}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{c.rowActionSetCurrent}</AlertDialogTitle>
                <AlertDialogDescription>{c.setCurrentConfirm}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t.shell.cancel}</AlertDialogCancel>
                <AlertDialogAction onClick={() => onSetCurrent(provider)}>
                  {c.rowActionSetCurrent}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-[var(--hm-danger)]"
              disabled={provider.is_current || editingBlocked}
              aria-describedby={provider.is_current ? "ccswitch-list-note" : undefined}
            >
              {c.rowActionDelete}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{c.rowActionDelete}</AlertDialogTitle>
              <AlertDialogDescription>{c.deleteConfirm}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t.shell.cancel}</AlertDialogCancel>
              <AlertDialogAction onClick={() => onDelete(provider)}>
                {c.rowActionDelete}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  )
}
