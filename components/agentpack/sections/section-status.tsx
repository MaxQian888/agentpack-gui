/** One measured fact: the number, and what it counts. */
export interface StatusFact {
  label: string
  value: React.ReactNode
}

/**
 * A section's summary, as one line — where a row of stat tiles used to be.
 *
 * design.md bans the row of uniform stat cards outright, and on the Install &
 * repair pages it was worse than a style problem. Three of the four tiles read
 * `—` with the same "waiting for the desktop app" caption repeated under each,
 * and the one or two that carried a real number were restated verbatim in the
 * panel beside them and again in the change tray below. The same figure in
 * three places is not a summary, it is noise with a border around it.
 *
 * So the summary is set as what it is: a sentence of facts. Values in mono
 * because the machine produced them, labels in meta ink, one hairline band
 * spanning the workbench. An unmeasured fact is `—` plus `note` saying why —
 * never a plausible-looking zero.
 */
export function SectionStatus({
  label,
  facts,
  notes,
}: {
  /** Names the region for assistive tech, e.g. "Runtime status summary". */
  label: string
  facts: readonly StatusFact[]
  /**
   * Why the `—`s are `—`. Falsy entries drop out and identical strings collapse,
   * so two facts waiting on the same scan say so once instead of stacking the
   * same caption twice — which is what the tiles did four times over.
   */
  notes?: readonly React.ReactNode[]
}) {
  const reasons = [...new Set(notes?.filter(Boolean) ?? [])]
  return (
    <div
      role="region"
      aria-label={label}
      className="flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-1.5 rounded-lg border px-4 py-3"
    >
      {/* Label first, value second: it reads as a sentence, and it is the one
          order that survives a value which is a word rather than a number
          ("Scan status  Not measured"). Space does the separating — a "·"
          between facts is orphaned at one end of every line the row wraps at,
          and the 20px gap against the 6px inside a pair already groups them. */}
      {facts.map((fact) => (
        <span key={fact.label} className="flex min-w-0 items-baseline gap-1.5">
          <span className="text-sm text-muted-foreground">{fact.label}</span>
          <span className="font-mono font-medium tabular-nums [overflow-wrap:anywhere]">
            {fact.value}
          </span>
        </span>
      ))}
      {reasons.length > 0 ? (
        <span className="min-w-0 basis-full">
          {reasons.map((reason, i) => (
            <span key={i} className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {reason}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  )
}
