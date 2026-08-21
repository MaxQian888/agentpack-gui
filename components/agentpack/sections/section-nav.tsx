import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

/** One destination in the aside: what it opens, and why you'd open it. */
export interface NavChoice {
  id: string
  title: string
  description?: string
  /** Whether its panel is the one currently open below. */
  active?: boolean
  onSelect: () => void
}

/**
 * The aside's list of sub-views, as one ruled panel.
 *
 * It replaced a column of identical tiles — each a bordered box holding a
 * title, one line of hint, and a button whose label repeated the title word for
 * word. Three of those stacked is the shape design.md names as the reliable
 * generated-UI tell, and the doubled label meant a screen reader read
 * "Installed … Installed" on every one.
 *
 * So: one box, one row per destination, the row itself the control. The row's
 * accessible name is the title alone and the hint is wired up with
 * `aria-describedby`, so the name stays short without the hint being lost.
 * Selection is `aria-pressed` rather than a link, because the panel opens in
 * place below rather than navigating anywhere.
 */
export function SectionNav({
  choices,
  className,
}: {
  choices: readonly NavChoice[]
  className?: string
}) {
  return (
    <div className={cn("min-w-0 overflow-hidden rounded-lg border", className)}>
      {choices.map((choice) => {
        const descId = `${choice.id}-nav-desc`
        return (
          <button
            key={choice.id}
            type="button"
            aria-pressed={choice.active ?? false}
            aria-label={choice.title}
            aria-describedby={choice.description ? descId : undefined}
            onClick={choice.onSelect}
            className={cn(
              "flex w-full min-w-0 items-center gap-3 border-b px-4 py-3 text-left last:border-b-0",
              "transition-colors duration-(--hm-dur-fast) ease-(--hm-ease-out)",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
              choice.active ? "bg-[var(--hm-accent-soft)]" : "hover:bg-muted"
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{choice.title}</span>
              {choice.description ? (
                <span
                  id={descId}
                  className={cn(
                    "mt-0.5 block text-xs leading-relaxed",
                    // Muted ink on the accent wash misses 4.5:1 in dark mode, so
                    // the selected row steps up to body ink instead.
                    choice.active ? "text-[var(--hm-ink-2)]" : "text-muted-foreground"
                  )}
                >
                  {choice.description}
                </span>
              ) : null}
            </span>
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0",
                choice.active ? "text-[var(--hm-accent)]" : "text-muted-foreground"
              )}
            />
          </button>
        )
      })}
    </div>
  )
}
