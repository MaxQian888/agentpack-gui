"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, MoreHorizontal, RefreshCw, Tag, Trash2 } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useT } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { isSafePiPackageSource, piResourcesOnCount } from "@/lib/pi/management"
import type { PiPackageRecord, PiResourceKind } from "@/lib/pi/types"
import { PI_RESOURCE_KINDS, type PiManagementController } from "../../pi-controller"
import { CapabilityEmpty, CapabilityList, CapabilityRow, RowChip } from "../capability-list"
import { FilterField, FilterToolbar, MoreFilters, ScopeChip, SearchField } from "../filter-bar"
import { declaredCount, ResourceToggles } from "./helpers"
import { PiPackageDetailDialog } from "./package-detail-dialog"

type KindFilter = PiResourceKind | "all"
type Sort = "name" | "resources"

/**
 * What the selected scope loads, as one ruled list.
 *
 * Every package used to be its own `Card` carrying up to five badges, a
 * two-column grid of bordered resource boxes and its own row of buttons, so a
 * machine with six packages was six near-identical blocks about a screen tall
 * each. The facts moved into the row's tags, the resource controls became
 * chips, and only the two states that change what you would do (a package whose
 * folder is gone, a package the project overrides) still draw a status chip.
 */
export function PiPackagesView({
  controller,
  onFindPackages,
}: {
  controller: PiManagementController
  onFindPackages: () => void
}) {
  const m = useT().pi
  const {
    snapshot,
    scopeKind,
    scopeReady,
    scanError,
    projectMissing,
    loading,
    scan,
    chooseProject,
    setPending,
    toggleResource,
    toggleResourcePath,
  } = controller

  const [query, setQuery] = useState("")
  const [kind, setKind] = useState<KindFilter>("all")
  const [sort, setSort] = useState<Sort>("name")
  const [showInherited, setShowInherited] = useState(true)
  const [detail, setDetail] = useState<string | null>(null)
  const [pinning, setPinning] = useState<PiPackageRecord | null>(null)

  const packages = useMemo(() => snapshot?.packages ?? [], [snapshot])

  const counts = useMemo(() => {
    const out: Record<PiResourceKind, number> = {
      extensions: 0,
      skills: 0,
      prompts: 0,
      themes: 0,
    }
    for (const pkg of packages) {
      for (const each of PI_RESOURCE_KINDS) {
        if ((pkg.resources[each]?.declared.length ?? 0) > 0) out[each] += 1
      }
    }
    return out
  }, [packages])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = packages.filter((pkg) => {
      if (!showInherited && pkg.inherited) return false
      if (kind !== "all" && (pkg.resources[kind]?.declared.length ?? 0) === 0) return false
      if (needle && !`${pkg.identity} ${pkg.source}`.toLowerCase().includes(needle)) return false
      return true
    })
    return [...rows].sort((a, b) =>
      sort === "name"
        ? a.identity.localeCompare(b.identity)
        : piResourcesOnCount(b) - piResourcesOnCount(a) || a.identity.localeCompare(b.identity)
    )
  }, [kind, packages, query, showInherited, sort])

  const detailPkg = packages.find((pkg) => pkg.source === detail) ?? null

  if (!scopeReady || projectMissing) {
    // The status band above already says *why* the facts read as dashes (and
    // the scope bar that a typed folder is not there), so this says what is
    // missing and offers the one control that fixes it.
    return (
      <CapabilityEmpty
        message={m.noProjectChosen}
        action={
          <Button variant="outline" size="sm" onClick={() => void chooseProject()}>
            {m.chooseFolder}
          </Button>
        }
      />
    )
  }

  if (scanError !== null) {
    // A failed read is not an empty scope. Said where the list would be, with
    // the reason as Pi reported it and the one thing to try.
    return (
      <div className="flex min-w-0 flex-col gap-3">
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertDescription className="[overflow-wrap:anywhere]">
            {m.scanFailed(scanError)}
          </AlertDescription>
        </Alert>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 self-start"
          disabled={loading}
          onClick={() => void scan()}
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          {m.refresh}
        </Button>
      </div>
    )
  }

  const activeFilters = (sort === "name" ? 0 : 1) + (showInherited ? 0 : 1)
  const KINDS: KindFilter[] = ["all", ...PI_RESOURCE_KINDS]

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <FilterToolbar
        label={m.kindFilter}
        scope={KINDS.map((each) => (
          <ScopeChip
            key={each}
            active={kind === each}
            onSelect={() => setKind(each)}
            label={each === "all" ? m.filterAll : (m.resources[each] ?? each)}
            count={each === "all" ? packages.length : counts[each]}
          />
        ))}
      >
        <SearchField value={query} onChange={setQuery} label={m.searchPlaceholder} />
        <MoreFilters
          label={m.filtersLabel}
          resetLabel={m.filtersReset}
          active={activeFilters}
          onReset={() => {
            setSort("name")
            setShowInherited(true)
          }}
        >
          <FilterField label={m.sortLabel}>
            <Select value={sort} onValueChange={(value) => setSort(value as Sort)}>
              <SelectTrigger size="sm" className="w-full" aria-label={m.sortLabel}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">{m.sortName}</SelectItem>
                <SelectItem value="resources">{m.sortResources}</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
          <Label className="flex items-center justify-between gap-3 text-xs font-normal">
            {m.showInherited}
            <Switch checked={showInherited} onCheckedChange={setShowInherited} />
          </Label>
        </MoreFilters>
        {packages.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-2"
            onClick={() =>
              setPending({
                action: { kind: "updateAll" },
                source: m.allPackages,
                scope: scopeKind,
              })
            }
          >
            <RefreshCw className="size-4" />
            {m.updateAll}
          </Button>
        ) : null}
      </FilterToolbar>

      {snapshot?.errors.map((error) => (
        <Alert key={error} variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertDescription className="[overflow-wrap:anywhere]">{error}</AlertDescription>
        </Alert>
      ))}

      {packages.length === 0 ? (
        <CapabilityEmpty
          message={m.noPackages}
          action={
            <Button variant="outline" size="sm" onClick={onFindPackages}>
              {m.findPackages}
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <CapabilityEmpty message={m.noMatches} />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{m.resourceHint}</p>
          <CapabilityList label={m.packagesListLabel}>
            {filtered.map((pkg) => (
              <CapabilityRow
                key={`${pkg.scope}:${pkg.source}`}
                title={pkg.identity}
                openLabel={m.openPackage(pkg.identity)}
                onOpen={() => setDetail(pkg.source)}
                tags={
                  <>
                    <span>{pkg.sourceKind}</span>
                    {pkg.version ? (
                      <span className="font-mono [overflow-wrap:anywhere]">{pkg.version}</span>
                    ) : null}
                    {pkg.pinned ? <span>{m.pinned}</span> : null}
                    {pkg.inherited ? <span>{m.inherited}</span> : null}
                    <span className="font-mono [overflow-wrap:anywhere]">{pkg.source}</span>
                  </>
                }
                description={
                  !pkg.installed
                    ? m.missingHint
                    : pkg.overridden
                      ? m.overriddenResourceHint
                      : declaredCount(pkg) > 0 && piResourcesOnCount(pkg) === 0
                        ? m.resourcesOff
                        : undefined
                }
                status={
                  <>
                    {!pkg.installed ? <RowChip tone="danger">{m.missing}</RowChip> : null}
                    {pkg.overridden ? <RowChip tone="warn">{m.overridden}</RowChip> : null}
                  </>
                }
                actions={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={m.actions}>
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {!pkg.pinned ? (
                        <DropdownMenuItem
                          onSelect={() =>
                            setPending({
                              action: { kind: "update", source: pkg.source },
                              source: pkg.source,
                              scope: pkg.scope,
                            })
                          }
                        >
                          <RefreshCw className="size-4" /> {m.update}
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem onSelect={() => setPinning(pkg)}>
                        <Tag className="size-4" /> {m.changePin}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() =>
                          setPending({
                            action: { kind: "remove", source: pkg.source },
                            source: pkg.source,
                            scope: pkg.scope,
                          })
                        }
                      >
                        <Trash2 className="size-4" /> {m.remove}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              >
                <ResourceToggles
                  pkg={pkg}
                  disabledReason={pkg.overridden ? m.overriddenResourceHint : undefined}
                  onToggle={(each, enabled) => void toggleResource(pkg, each, enabled)}
                />
              </CapabilityRow>
            ))}
          </CapabilityList>
        </>
      )}

      <PiPackageDetailDialog
        pkg={detailPkg}
        open={detailPkg !== null}
        onOpenChange={(open) => !open && setDetail(null)}
        onToggle={(each, enabled) => detailPkg && void toggleResource(detailPkg, each, enabled)}
        onPathToggle={(each, path, enabled) =>
          detailPkg && void toggleResourcePath(detailPkg, each, path, enabled)
        }
      />

      {pinning ? (
        <ChangePinDialog
          key={pinning.source}
          pkg={pinning}
          onClose={() => setPinning(null)}
          onApply={(source, scope) => {
            setPinning(null)
            setPending({ action: { kind: "install", source }, source, scope })
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * Repinning a package, as its own step.
 *
 * This was an `Input` that appeared inline in the row's button strip, but only
 * for an already-pinned package, so the one action that changes a version was
 * unreachable for every package that had never been pinned and shifted the
 * row's layout for the ones that had.
 */
function ChangePinDialog({
  pkg,
  onClose,
  onApply,
}: {
  pkg: PiPackageRecord
  onClose: () => void
  onApply: (source: string, scope: "global" | "project") => void
}) {
  const m = useT().pi
  /**
   * Seeded from the package and owned outright from then on. Falling back to
   * `pkg.source` whenever the field went empty meant clearing it typed the old
   * source straight back in, so the next keystroke appended to the value the
   * user had just deleted. The dialog is keyed on the package instead, so a
   * different row opens with a fresh field.
   */
  const [source, setSource] = useState(pkg.source)
  const trimmed = source.trim()
  const unsafe = trimmed.length > 0 && !isSafePiPackageSource(trimmed)
  const changed = trimmed.length > 0 && trimmed !== pkg.source && !unsafe
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{m.changePinTitle(pkg.identity)}</DialogTitle>
          <DialogDescription>{m.changePinHint}</DialogDescription>
        </DialogHeader>
        <Input
          aria-label={m.changePin}
          aria-invalid={unsafe}
          value={source}
          onChange={(event) => setSource(event.target.value)}
          className="font-mono text-xs"
        />
        {unsafe ? <p className="text-xs text-[var(--hm-danger)]">{m.sourceUnsafe}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {m.cancel}
          </Button>
          <Button disabled={!changed} onClick={() => onApply(trimmed, pkg.scope)}>
            {m.changePinApply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
