import { cn } from "@/lib/utils"

export function SectionShell({
  title,
  subtitle,
  help,
  wide,
  children,
}: {
  title: string
  subtitle?: string
  /** Optional inline affordance (e.g. a <HelpTip/>) rendered beside the title. */
  help?: React.ReactNode
  /** Widen the content column (e.g. the dashboard's responsive card grid). */
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={cn("mx-auto flex flex-col gap-5", wide ? "max-w-5xl" : "max-w-3xl")}>
      <div data-tour="section-heading">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          {help}
        </div>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  )
}
