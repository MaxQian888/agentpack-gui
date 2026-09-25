"use client"

import { Check, Minus } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/provider"
import { piResourcesOnFor } from "@/lib/pi/management"
import type { PiPackageRecord, PiResourceKind } from "@/lib/pi/types"
import { PI_RESOURCE_KINDS } from "../../pi-controller"

/**
 * How many of a resource kind's declared files this scope actually loads.
 *
 * Three different answers hide behind one `enabled` flag. The kind can be off,
 * on in full, or on with Pi's narrowing globs cutting it down to a subset. A
 * chip that only said on or off called the third case "on", which is how
 * someone concludes a skill is loaded when a `-path` override switched it off.
 */
/** Total declared files across every kind, which is what the list sorts on. */
export function declaredCount(pkg: PiPackageRecord): number {
  return PI_RESOURCE_KINDS.reduce(
    (total, kind) => total + (pkg.resources[kind]?.declared.length ?? 0),
    0
  )
}

/** The kinds a package actually ships. A package with no themes gets no themes chip. */
export function declaredKinds(pkg: PiPackageRecord): PiResourceKind[] {
  return PI_RESOURCE_KINDS.filter((kind) => (pkg.resources[kind]?.declared.length ?? 0) > 0)
}

/**
 * A package's resource kinds as press-to-toggle chips.
 *
 * This replaced four bordered boxes per package, each holding a `Switch`, a
 * label, a count and a nested column of per-path switches. At ten packages that
 * was forty switches and forty boxes inside boxes, which design.md calls a
 * smell in its own right. The chip carries the same fact in a tenth of the ink,
 * and the per-file overrides moved into the package's own dialog where there is
 * room to explain them.
 */
export function ResourceToggles({
  pkg,
  onToggle,
  disabledReason,
}: {
  pkg: PiPackageRecord
  onToggle: (kind: PiResourceKind, enabled: boolean) => void
  /** Why the chips cannot be pressed. A disabled control with no reason is a bug. */
  disabledReason?: string
}) {
  const m = useT().pi
  const kinds = declaredKinds(pkg)
  if (kinds.length === 0) return null
  return (
    // Grouped and named after the package: in a list of six, a bare "Skills"
    // toggle has nothing to say which package it belongs to.
    <div
      role="group"
      aria-label={pkg.identity}
      className="flex min-w-0 flex-wrap items-center gap-1.5"
    >
      {kinds.map((kind) => {
        const state = pkg.resources[kind]
        const total = state.declared.length
        const on = piResourcesOnFor(state)
        const label = m.resources[kind] ?? kind
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={on > 0}
            disabled={!!disabledReason}
            title={disabledReason}
            onClick={() => onToggle(kind, on === 0)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs",
              "transition-colors duration-(--hm-dur-fast) ease-(--hm-ease-out)",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
              on > 0
                ? "border-[var(--hm-accent)] bg-[var(--hm-accent-soft)] font-medium text-[var(--hm-ink)]"
                : "text-muted-foreground hover:bg-muted",
              disabledReason && "cursor-not-allowed opacity-50 hover:bg-transparent"
            )}
          >
            {on > 0 ? (
              <Check aria-hidden="true" className="size-3" />
            ) : (
              <Minus aria-hidden="true" className="size-3" />
            )}
            {label}
            <span className="font-mono tabular-nums">
              {on === total ? total : `${on}/${total}`}
            </span>
          </button>
        )
      })}
    </div>
  )
}
