/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 */
/* Hallmark · genre: modern-minimal · macrostructure: asymmetric settings workbench · theme: inherited Cobalt · contrast: pass (40–41) · slop: pass (42–49) · mobile: pass (34, 49, 50–57) */
import { cn } from "@/lib/utils"
import { SectionShell } from "./section-shell"

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
    <div className="min-w-0 px-4 py-3">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 min-w-0 font-mono text-xl font-semibold tracking-tight tabular-nums [overflow-wrap:anywhere]">
        {value}
      </dd>
      {detail ? (
        <div className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">{detail}</div>
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
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium">{title}</h3>
          {description ? (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
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
          className="grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:flex sm:flex-wrap [&>div]:bg-background sm:[&>div]:flex-[1_1_8rem]"
        >
          {metrics}
        </dl>
      ) : null}

      <div className="grid min-w-0 gap-4 min-[1100px]:grid-cols-12">
        <div
          className={cn("min-w-0", aside ? "min-[1100px]:col-span-8" : "min-[1100px]:col-span-12")}
        >
          {primary}
        </div>
        {aside ? (
          <aside
            aria-label={actionsLabel}
            className="grid min-w-0 content-start gap-4 self-start min-[768px]:max-[1099px]:grid-cols-2 min-[1100px]:col-span-4"
          >
            {aside}
          </aside>
        ) : null}
      </div>

      {detail ? <div className="min-w-0">{detail}</div> : null}
    </SectionShell>
  )
}
