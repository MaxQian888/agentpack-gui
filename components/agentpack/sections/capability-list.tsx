import { cn } from "@/lib/utils"

/**
 * A capability inventory, as one ruled panel.
 *
 * Both managers used to render one `<Card>` per skill / per server, which is the
 * shape design.md § 5 bans outright — "three cards of the same shape in a row is
 * the single most reliable generated-UI tell" — and at forty catalog entries it
 * stacked forty borders down the page with nothing but padding between them. One
 * border, hairlines between rows: the same information, a tenth of the ink.
 *
 * It scrolls inside itself past `--hm-list-max-h`. A list's length is the
 * machine's, not the design's — twenty-two skills here, two hundred on the next
 * machine — and letting it set the page height moved everything downstream of
 * it: the aside's destinations, the panel a destination opens, the empty space
 * a short list leaves. Capped, the layout is the same on every machine and the
 * only thing that varies is how far you scroll within the panel.
 */
export function CapabilityList({
  label,
  className,
  children,
}: {
  /** Names the list for assistive tech, e.g. "Installed skills". */
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <ul
      aria-label={label}
      className={cn(
        "max-h-(--hm-list-max-h) min-w-0 overflow-x-hidden overflow-y-auto rounded-lg border",
        className
      )}
    >
      {children}
    </ul>
  )
}

/**
 * One row of that panel: identity on the left, state on the right.
 *
 * The `tags` slot is the quiet half of what used to be a row of six outline
 * badges — "bundled", "symlink", "content match" are facts, not warnings, so
 * they set as muted text beside the name rather than as six bordered pills. Only
 * `status` (an update waiting, a conflict) still draws a chip, which is what
 * makes a chip mean something again when one does appear.
 */
export function CapabilityRow({
  lead,
  title,
  titleId,
  tags,
  description,
  onOpen,
  openLabel,
  status,
  actions,
  children,
}: {
  /** Selection checkbox, if the list supports batch actions. */
  lead?: React.ReactNode
  title: React.ReactNode
  tags?: React.ReactNode
  description?: React.ReactNode
  /** Opens the row's detail view; makes the title the button that does it. */
  onOpen?: () => void
  /** The title button's accessible name, when the visible title is decorated. */
  openLabel?: string
  titleId?: string
  /** Exceptional state only — an update, a conflict. Never a plain fact. */
  status?: React.ReactNode
  actions?: React.ReactNode
  /** Row-owned controls (the catalog's per-agent toggles, a key field). */
  children?: React.ReactNode
}) {
  const name = (
    <span id={titleId} className="min-w-0 font-medium [overflow-wrap:anywhere]">
      {title}
    </span>
  )
  return (
    <li className="min-w-0 border-b last:border-b-0">
      <div className="flex min-w-0 items-start gap-3 px-4 py-3">
        {lead ? <div className="mt-0.5 shrink-0">{lead}</div> : null}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            {onOpen ? (
              <button
                type="button"
                onClick={onOpen}
                aria-label={openLabel}
                className="min-w-0 rounded-sm text-left underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                {name}
              </button>
            ) : (
              name
            )}
            {tags ? (
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                {tags}
              </span>
            ) : null}
          </div>
          {description ? (
            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{description}</p>
          ) : null}
          {children ? <div className="mt-2.5 min-w-0">{children}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status}
          {actions}
        </div>
      </div>
    </li>
  )
}

/**
 * A group heading inside the list — the catalog's categories, set as a band on
 * the raised paper rather than as a floating `<h3>` above yet another box.
 */
export function CapabilityGroupHeading({
  title,
  count,
}: {
  title: string
  count: React.ReactNode
}) {
  return (
    <li className="sticky top-0 z-10 border-b bg-[var(--hm-paper-2)] px-4 py-1.5">
      <h4 className="flex items-baseline gap-2 font-mono text-2xs tracking-(--hm-tracking-mono) text-muted-foreground uppercase">
        {title}
        <span className="tabular-nums">{count}</span>
      </h4>
    </li>
  )
}

/**
 * The one chip a row is allowed to draw, in the four functional tones.
 *
 * Rows used to carry up to eight `<Badge>`s at once — four naming agents, then
 * "bundled", "symlink", "content match", "update available" — so the one that
 * meant "act on this" looked exactly like the seven that meant "for your
 * information". Facts moved to `tags` as plain muted text; this is reserved for
 * state that changes what you'd do, and it is a hairline and a colour word, not
 * a filled block (design.md § 3: status colour is a dot, a chip, or one word).
 */
export function RowChip({
  tone = "neutral",
  icon,
  children,
}: {
  tone?: "accent" | "warn" | "danger" | "neutral"
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  const toneClass = {
    accent: "border-[var(--hm-accent)] text-[var(--hm-accent)]",
    warn: "border-[var(--hm-warn)] text-[var(--hm-warn)]",
    danger: "border-[var(--hm-danger)] text-[var(--hm-danger)]",
    neutral: "text-muted-foreground",
  }[tone]
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs leading-none",
        toneClass
      )}
    >
      {icon}
      {children}
    </span>
  )
}

/** The empty state: what the filter found, and what to do about it. */
export function CapabilityEmpty({
  message,
  action,
}: {
  message: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center">
      <p className="max-w-prose text-sm text-muted-foreground">{message}</p>
      {action}
    </div>
  )
}
