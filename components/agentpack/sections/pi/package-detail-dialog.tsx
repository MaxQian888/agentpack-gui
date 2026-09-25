"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { useT } from "@/lib/i18n/provider"
import { isPiExactResourcePath, piResourcePathEnabled, piResourcesOnFor } from "@/lib/pi/management"
import type { PiPackageRecord, PiResourceKind } from "@/lib/pi/types"
import { PI_RESOURCE_KINDS } from "../../pi-controller"
import { declaredKinds } from "./helpers"

/**
 * One package's resources, down to individual files.
 *
 * The per-path switches used to sit in the list row, nested two boxes deep
 * inside a card inside a card, which is what made a machine with a handful of
 * packages unreadable. They belong here: this is the one surface with room to
 * say which paths a glob narrowed away, and why a pattern cannot be switched at
 * all. The row keeps the common action (a whole resource kind on or off) and
 * hands the rare one to this dialog.
 */
export function PiPackageDetailDialog({
  pkg,
  open,
  onOpenChange,
  onToggle,
  onPathToggle,
}: {
  pkg: PiPackageRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onToggle: (kind: PiResourceKind, enabled: boolean) => void
  onPathToggle: (kind: PiResourceKind, resourcePath: string, enabled: boolean) => void
}) {
  const m = useT().pi
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{pkg ? m.detailTitle(pkg.identity) : ""}</DialogTitle>
          <DialogDescription>{m.detailIntro}</DialogDescription>
        </DialogHeader>
        {pkg ? <DetailBody pkg={pkg} onToggle={onToggle} onPathToggle={onPathToggle} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 font-mono text-xs [overflow-wrap:anywhere]">{value}</span>
    </div>
  )
}

function DetailBody({
  pkg,
  onToggle,
  onPathToggle,
}: {
  pkg: PiPackageRecord
  onToggle: (kind: PiResourceKind, enabled: boolean) => void
  onPathToggle: (kind: PiResourceKind, resourcePath: string, enabled: boolean) => void
}) {
  const m = useT().pi
  const kinds = declaredKinds(pkg)
  const shown: PiResourceKind[] = kinds.length > 0 ? kinds : PI_RESOURCE_KINDS
  return (
    <div className="flex max-h-[60vh] min-w-0 flex-col gap-4 overflow-y-auto">
      <div className="flex min-w-0 flex-col gap-1 rounded-lg border px-3 py-2">
        <Fact label={m.detailSource} value={pkg.source} />
        {pkg.version ? <Fact label={m.detailVersion} value={pkg.version} /> : null}
        {pkg.installedPath ? <Fact label={m.detailPath} value={pkg.installedPath} /> : null}
      </div>

      {pkg.overridden ? (
        <p className="text-xs text-[var(--hm-warn)]">{m.overriddenResourceHint}</p>
      ) : null}

      <div className="min-w-0 overflow-hidden rounded-lg border">
        {shown.map((kind) => {
          const state = pkg.resources[kind]
          const declared = state?.declared ?? []
          const on = piResourcesOnFor(state)
          return (
            <div key={kind} className="min-w-0 border-b p-3 last:border-b-0">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="font-medium">{m.resources[kind] ?? kind}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {on}/{declared.length}
                  </span>
                </span>
                <Switch
                  aria-label={m.resources[kind] ?? kind}
                  checked={state?.enabled ?? true}
                  disabled={pkg.overridden}
                  onCheckedChange={(enabled) => onToggle(kind, enabled)}
                />
              </div>
              {declared.length === 0 ? (
                <p className="mt-1.5 text-xs text-muted-foreground">{m.detailNoPaths}</p>
              ) : !pkg.overridden && !state?.enabled ? (
                /* The per-file switches below are off while the kind is; say
                   so once rather than render a column of dead controls. */
                <p id={`pi-kind-off-${kind}`} className="mt-1.5 text-xs text-muted-foreground">
                  {m.detailKindOff}
                </p>
              ) : null}
              {declared.length === 0 ? null : (
                <ul className="mt-2 flex min-w-0 flex-col gap-1.5">
                  {declared.map((resourcePath) => {
                    const exact = isPiExactResourcePath(resourcePath)
                    const pathOn =
                      (state?.enabled ?? false) &&
                      (!state?.configured || piResourcePathEnabled(resourcePath, state.filters))
                    return (
                      <li
                        key={resourcePath}
                        className="flex min-w-0 items-center justify-between gap-3"
                      >
                        <span className="min-w-0 font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
                          {resourcePath}
                        </span>
                        {exact ? (
                          <Switch
                            aria-label={resourcePath}
                            aria-describedby={
                              !pkg.overridden && !state?.enabled ? `pi-kind-off-${kind}` : undefined
                            }
                            checked={pathOn}
                            disabled={pkg.overridden || !state?.enabled}
                            onCheckedChange={(next) => onPathToggle(kind, resourcePath, next)}
                          />
                        ) : (
                          <span className="shrink-0 text-2xs text-muted-foreground">
                            {m.detailGlobOnly}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
