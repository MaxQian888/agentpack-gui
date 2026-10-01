"use client"

import { useEffect, useRef } from "react"

/**
 * The one panel a `SectionNav` choice has open, in the workbench's primary
 * column.
 *
 * It used to be a band appended *below* the two columns, which read as an
 * append rather than a switch: on a machine with twenty-odd skills, clicking
 * "Bundled" left the whole installed list in place and opened the catalog a
 * screen and a half further down, so the click looked like it had done
 * nothing. A nav that swaps what the column shows is the shape the aside was
 * always describing — one view at a time, the active one marked in the list.
 *
 * Switching still scrolls the panel into view, because the column the reader
 * was half-way down is the one being replaced. The **first** render doesn't:
 * arriving in a section must leave its heading and status band on screen. No
 * `behavior` is passed, so the reduce-motion rules in globals.css still decide
 * whether the jump animates.
 */
export function SectionView({
  label,
  title,
  choice,
  children,
}: {
  label: string
  /** Heading for the open view. */
  title: string
  /** Which view this is — a change in it is what scrolls. */
  choice: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLElement>(null)
  const opened = useRef(choice)

  useEffect(() => {
    if (opened.current === choice) return
    opened.current = choice
    const el = ref.current
    if (!el) return
    el.scrollIntoView({ block: "start" })
    // The swapped view arrives the way a destination does (`hm-enter`), so the
    // switch reads as a switch rather than the column's text changing under
    // the cursor. Only on a change: on first render the shell's own entrance
    // is already playing, and two nested ones would double the rise. A CSS
    // class rather than `el.animate()`, so the reduce-motion rules apply.
    el.classList.remove("hm-enter")
    void el.offsetWidth
    el.classList.add("hm-enter")
  }, [choice])

  return (
    <section ref={ref} aria-label={label} className="min-w-0 scroll-mt-4">
      <h3 className="mb-3 font-medium">{title}</h3>
      {children}
    </section>
  )
}
