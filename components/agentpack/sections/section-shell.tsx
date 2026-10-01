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
    <div
      className={cn(
        "mx-auto flex flex-col gap-5",
        wide
          ? // The third step lands at 1600px — above every size design.md
            // verifies, so nothing that was checked at the 72rem cap changes.
            "max-w-[var(--hm-content-width-wide)] min-[1600px]:max-w-[var(--hm-content-width-max)]"
          : "max-w-[var(--hm-content-width)]"
      )}
    >
      {/* The actions share the title's row only. Beside the whole block they
          took their width out of the subtitle too, and on a phone that squeezed
          a one-line sentence into a five-line column next to a Rescan button. */}
      <div
        data-tour="section-heading"
        className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1"
      >
        <div className="flex min-w-0 items-center gap-2 self-center">
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          {help}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
        {subtitle ? (
          <p className="col-span-2 max-w-[var(--hm-measure)] text-sm text-pretty text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
      </div>
      {children}
    </div>
  )
}
