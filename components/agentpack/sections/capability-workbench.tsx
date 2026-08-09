/* Hallmark · pre-emit critique: P5 H5 E4 S5 R4 V4 */
/* Hallmark · macrostructure: asymmetric capability workbench · theme: inherited Cobalt Workbench · slop: pass within existing application chrome */
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
      <dd className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{value}</dd>
      {detail ? <div className="mt-1 truncate text-xs text-muted-foreground">{detail}</div> : null}
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
  primary,
  aside,
  detail,
}: {
  title: string
  subtitle?: string
  help?: React.ReactNode
  actions?: React.ReactNode
  summaryLabel: string
  actionsLabel: string
  metrics?: React.ReactNode
  primary: React.ReactNode
  aside?: React.ReactNode
  detail?: React.ReactNode
}) {
  return (
    <SectionShell title={title} subtitle={subtitle} help={help} actions={actions} wide>
      {metrics ? (
        <dl
          role="region"
          aria-label={summaryLabel}
          className="grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3 lg:grid-cols-6 [&>div]:bg-background"
        >
          {metrics}
        </dl>
      ) : null}

      <div className="grid min-w-0 gap-4 min-[1100px]:grid-cols-12">
        <div className="min-w-0 min-[1100px]:col-span-8">{primary}</div>
        {aside ? (
          <aside
            aria-label={actionsLabel}
            className="grid min-w-0 gap-4 min-[768px]:max-[1099px]:grid-cols-2 min-[1100px]:col-span-4"
          >
            {aside}
          </aside>
        ) : null}
      </div>

      {detail ? <div className="min-w-0">{detail}</div> : null}
    </SectionShell>
  )
}
