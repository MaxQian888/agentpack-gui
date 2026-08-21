/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 */
/* Hallmark · genre: modern-minimal · macrostructure: settings workbench · theme: inherited Cobalt · contrast: pass (40–41) · slop: pass (42–49) · mobile: pass (34, 49, 50–57) */
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"

/**
 * One preference: what it is on the left, the control that changes it on the
 * right, and — where the name doesn't already say it — one line explaining what
 * it will do.
 *
 * The row is the whole reason this file exists. Settings used to be a stack of
 * `justify-between` label/control pairs written out at each call site, each
 * separated by its own `border-t pt-4`, with the explanation either missing or
 * folded into the label. Reading down the page you couldn't tell where one
 * preference ended and the next began, and half the switches said nothing about
 * their effect — a global hotkey and "check for updates" looked equally weighty.
 *
 * `htmlFor` points at a real control id so the label click reaches it. A control
 * that has no single id — a segmented group of buttons — passes `labelId`
 * instead and sets `aria-labelledby` on its own root.
 */
export function SettingsRow({
  label,
  hint,
  htmlFor,
  labelId,
  control,
  note,
}: {
  label: string
  hint?: React.ReactNode
  /** Id of the input this labels. Omit for a group, and pass `labelId`. */
  htmlFor?: string
  /** Id given to the label text, for a group's `aria-labelledby`. */
  labelId?: string
  control: React.ReactNode
  /** Rendered under the row, full width — for a limit the row has to admit. */
  note?: React.ReactNode
}) {
  return (
    <div className="min-w-0 px-4 py-3.5">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-2.5">
        <div className="min-w-0 flex-1 basis-56">
          <Label
            id={labelId}
            htmlFor={htmlFor}
            className={cn("text-sm font-medium", htmlFor && "cursor-pointer")}
          >
            {label}
          </Label>
          {hint ? (
            <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">{hint}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">{control}</div>
      </div>
      {note ? <div className="mt-2.5 min-w-0">{note}</div> : null}
    </div>
  )
}

/**
 * A run of rows under one heading. The heading sits on the raised paper as a
 * band across the panel, so the groups read as sections of one instrument
 * rather than as three cards that happen to be stacked — design.md § 5: a box
 * inside a box wants a section rule instead.
 */
export function SettingsGroup({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section aria-label={title} className="min-w-0 border-b last:border-b-0">
      <div className="bg-muted/30 px-4 py-3">
        <h3 className="font-mono text-[var(--hm-text-2xs)] tracking-[var(--hm-tracking-mono)] text-muted-foreground uppercase">
          {title}
        </h3>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="min-w-0 divide-y">{children}</div>
    </section>
  )
}

/** The outer hairline the groups live in. One panel, never one per group. */
export function SettingsPanel({
  label,
  lead,
  children,
}: {
  label: string
  /** Shown above the first group, inside the panel — e.g. a web-mode note. */
  lead?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section aria-label={label} className="min-w-0 overflow-hidden rounded-lg border">
      {lead ? <div className="border-b p-4">{lead}</div> : null}
      {children}
    </section>
  )
}
