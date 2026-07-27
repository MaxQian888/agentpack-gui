import { cn } from "@/lib/utils"

export function SectionShell({
  title,
  subtitle,
  help,
  actions,
  wide,
  children,
}: {
  title: string
  subtitle?: string
  /** Optional inline affordance (e.g. a <HelpTip/>) rendered beside the title. */
  help?: React.ReactNode
  /**
   * Section-level controls (e.g. the dashboard's Rescan button) rendered at the
   * end of the heading row, so they don't cost a whole row of vertical space.
   */
  actions?: React.ReactNode
  /** Widen the content column (e.g. the dashboard's responsive card grid). */
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={cn("mx-auto flex flex-col gap-5", wide ? "max-w-6xl" : "max-w-3xl")}>
      <div data-tour="section-heading" className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
            {help}
          </div>
          {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {children}
    </div>
  )
}
