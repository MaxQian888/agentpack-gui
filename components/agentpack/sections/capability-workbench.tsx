/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 */
/* Hallmark · genre: modern-minimal · macrostructure: asymmetric settings workbench · theme: inherited Cobalt · contrast: pass (40–41) · slop: pass (42–49) · mobile: pass (34, 49, 50–57) */
import { cn } from "@/lib/utils"
import { SectionShell } from "./section-shell"

/**
 * One measured fact in the workbench's summary band. Set as label → value on a
 * line, like `SectionStatus`, rather than as a tile: four equal boxes in a row
 * is the stat-card row design.md § 3 bans, and as tiles a long value
 * ("32,877,394", "CN¥22.58") was truncated by its own box.
 */
export function CapabilityMetric({
  label,
  value,
  detail,
}: {
  label: string
  value: React.ReactNode
  detail?: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-mono font-medium tabular-nums [overflow-wrap:anywhere]">
        {value}
      </dd>
      {detail ? (
        <dd className="min-w-0 text-xs text-muted-foreground [overflow-wrap:anywhere]">{detail}</dd>
      ) : null}
    </div>
  )
}

export function CapabilityTile({
  title,
  description,
  action,
  active = false,
  className,
  children,
}: {
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  active?: boolean
  className?: string
  children?: React.ReactNode
}) {
  return (
    <section
      aria-label={title}
      data-selected={active ? "true" : "false"}
      className={cn(
        "min-w-0 rounded-lg border bg-background p-4",
        active && "border-primary/50 bg-primary/[0.025]",
        className
      )}
    >
      {/* The action shares the title's row and nothing else. In a 4-column
          aside it used to stand beside title *and* description, which left the
          description a 120px column four lines deep next to a Re-detect button. */}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1">
        <h3 className="self-center font-medium">{title}</h3>
        {action ? <div className="shrink-0">{action}</div> : null}
        {description ? (
          <p className="col-span-2 text-xs leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children ? <div className="mt-3 min-w-0">{children}</div> : null}
    </section>
  )
}

export function CapabilityWorkbench({
  title,
  subtitle,
  help,
  actions,
  summaryLabel,
  actionsLabel,
  metrics,
  lead,
  primary,
  aside,
  detail,
}: {
  title: string
  subtitle?: string
  help?: React.ReactNode
  actions?: React.ReactNode
  /** Only needed alongside `metrics` — it names that strip's region. */
  summaryLabel?: string
  actionsLabel: string
  metrics?: React.ReactNode
  /**
   * A full-width band above the two columns, for a workspace whose summary is
   * one ranked verdict rather than a row of equal tiles (see the overview).
   * It spans the grid so the verdict is never read as a column heading.
   */
  lead?: React.ReactNode
  primary: React.ReactNode
  aside?: React.ReactNode
  detail?: React.ReactNode
}) {
  return (
    <SectionShell title={title} subtitle={subtitle} help={help} actions={actions} wide>
      {lead ? <div className="min-w-0">{lead}</div> : null}

      {metrics ? (
        <dl
          role="region"
          aria-label={summaryLabel}
          className="flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-1.5 rounded-lg border px-4 py-3"
        >
          {metrics}
        </dl>
      ) : null}

      <div className="grid min-w-0 gap-4 min-[1100px]:grid-cols-12">
        {/* A size container, so what sits inside can lay itself out against the
            column it actually has rather than the window: at 1100px the window
            is "lg" while this column is ~570px. */}
        <div
          className={cn(
            "@container min-w-0",
            aside ? "min-[1100px]:col-span-8" : "min-[1100px]:col-span-12"
          )}
        >
          {primary}
        </div>
        {aside ? (
          <aside
            aria-label={actionsLabel}
            // Two-up between 768 and 1100px. An odd card out takes the full row,
            // so a lone "Detected proxies" card isn't left at half width beside
            // an empty column.
            className="grid min-w-0 content-start gap-4 self-start min-[768px]:max-[1099px]:grid-cols-2 min-[768px]:max-[1099px]:[&>*:last-child:nth-child(odd)]:col-span-full min-[1100px]:col-span-4"
          >
            {aside}
          </aside>
        ) : null}
      </div>

      {detail ? <div className="min-w-0">{detail}</div> : null}
    </SectionShell>
  )
}
