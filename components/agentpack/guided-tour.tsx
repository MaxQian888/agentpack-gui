"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { useT } from "@/lib/i18n/provider"
import { SECTIONS, type SectionKey } from "./sidebar-nav"

/**
 * One stop on the tour: which section to switch to first (auto-navigation) and
 * which on-screen element to spotlight (matched by its `data-tour` attribute).
 */
interface TourStep {
  id: string
  section: SectionKey
  target: string
}

/**
 * The ordered walkthrough: the task rail, then **every** section in the order it
 * appears there, then the two things that tie the flow together — the ⌘K
 * palette and the change tray that leads to the review panel.
 *
 * Every section gets a stop on purpose — a tour that skips five of them leaves
 * the user believing those features don't exist. The section list is derived
 * from `SECTIONS` rather than retyped, so adding a section to the sidebar
 * without giving it a stop here is impossible; `guided-tour.test.tsx` also
 * asserts each stop has copy in both languages.
 *
 * Step ids match the section keys, which is what `messages.tour.steps` is keyed
 * by.
 */
const STEPS: readonly TourStep[] = [
  { id: "nav", section: "dashboard", target: "nav" },
  ...SECTIONS.map((s) => ({ id: s.key, section: s.key, target: "section-heading" })),
  { id: "command", section: "dashboard" as SectionKey, target: "command" },
  { id: "review", section: "presets" as SectionKey, target: "tray" },
]

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

/** Schedule a callback for the next frame, falling back to a timer under jsdom. */
function nextFrame(cb: () => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(cb)
    return () => cancelAnimationFrame(id)
  }
  const id = setTimeout(cb, 16)
  return () => clearTimeout(id)
}

/** Pick the popover position: below the target if there's room, else above, else beside it. */
function placement(rect: Rect | null): React.CSSProperties {
  if (!rect || typeof window === "undefined") {
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }
  }
  const vw = window.innerWidth
  const vh = window.innerHeight
  const gap = 12
  const width = Math.min(360, vw - 32)
  const below = vh - (rect.top + rect.height)
  const above = rect.top
  const right = vw - (rect.left + rect.width)
  const left = rect.left
  const clampX = (x: number) => Math.max(16, Math.min(x, vw - width - 16))
  const clampY = (y: number) => Math.max(16, Math.min(y, vh - 240))
  const centeredX = clampX(rect.left + rect.width / 2 - width / 2)
  if (below >= 200) return { top: rect.top + rect.height + gap, left: centeredX }
  if (above >= 200) return { bottom: vh - rect.top + gap, left: centeredX }
  if (right >= left) return { left: rect.left + rect.width + gap, top: clampY(rect.top) }
  return { right: vw - rect.left + gap, top: clampY(rect.top) }
}

/**
 * A spotlight product tour. Rendered only while running (the shell mounts it on
 * demand), it walks `STEPS` one at a time: switching the visible section via
 * `onNavigate`, dimming the app, and ringing the step's target while a popover
 * explains it. Next/Back/Skip drive it; Esc or finishing the last step calls
 * `onClose`. Positioning is best-effort — the copy and controls stand on their
 * own even if a target can't be measured.
 */
export function GuidedTour({
  onClose,
  onNavigate,
}: {
  onClose: () => void
  onNavigate: (section: SectionKey) => void
}) {
  const t = useT()
  const copyFor = t.tour.steps
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)

  const step = STEPS[index]

  // Navigate to the step's section, then measure its target once the DOM settles
  // (a section swap remounts the heading, so retry a few frames until it exists).
  // A target that never appears clears the ring rather than leaving it where it
  // was: the tray only exists while something is selected, and a ring still
  // drawn round the previous step's control would point at the wrong thing
  // while the copy described the right one.
  useEffect(() => {
    onNavigate(step.section)
    let cancel = () => {}
    let tries = 0
    const measure = () => {
      const el = document.querySelector(`[data-tour="${step.target}"]`)
      if (el) {
        const r = el.getBoundingClientRect()
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
      } else if (tries++ < 20) {
        cancel = nextFrame(measure)
      } else {
        setRect(null)
      }
    }
    cancel = nextFrame(measure)
    return () => cancel()
  }, [step.section, step.target, onNavigate])

  // Keep the spotlight aligned as the window resizes or the content scrolls —
  // and once a destination's entrance has settled, since the first measurement
  // is taken while it is still rising into place.
  useEffect(() => {
    const remeasure = () => {
      const el = document.querySelector(`[data-tour="${step.target}"]`)
      if (el) {
        const r = el.getBoundingClientRect()
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
      }
    }
    window.addEventListener("resize", remeasure)
    window.addEventListener("scroll", remeasure, true)
    window.addEventListener("animationend", remeasure, true)
    return () => {
      window.removeEventListener("resize", remeasure)
      window.removeEventListener("scroll", remeasure, true)
      window.removeEventListener("animationend", remeasure, true)
    }
  }, [step.target])

  // The tour is modal, so the keyboard starts inside it. Without this, focus
  // stayed on whatever launched the tour, behind the scrim, and Enter pressed
  // that again instead of advancing.
  const nextRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    nextRef.current?.focus()
  }, [])

  // Esc closes the tour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const isFirst = index === 0
  const isLast = index === STEPS.length - 1
  const next = () => (isLast ? onClose() : setIndex((i) => i + 1))
  const back = () => setIndex((i) => Math.max(0, i - 1))
  const copy = copyFor[step.id] ?? { title: step.id, body: "" }

  return (
    <div
      className="fixed inset-0 z-[100]"
      role="dialog"
      aria-modal="true"
      aria-label={t.tour.title}
    >
      {/* Full-screen click blocker; the dimming comes from the ring's box-shadow. */}
      <div className="absolute inset-0" />
      {rect ? (
        <div
          data-testid="tour-spotlight"
          // No transition: the ring's box is top/left/width/height, and design.md
          // § 6 animates transform and opacity only. It moves as the card does —
          // at once, with the step.
          className="pointer-events-none absolute rounded-lg ring-2 ring-primary"
          style={{
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/55" />
      )}

      <Card
        className="absolute w-[360px] max-w-[calc(100vw-2rem)] gap-3 p-4 shadow-xl"
        style={placement(rect)}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-medium">{copy.title}</h3>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {t.tour.progress(index + 1, STEPS.length)}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{copy.body}</p>
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t.tour.skip}
          </Button>
          <div className="flex gap-2">
            {!isFirst ? (
              <Button variant="outline" size="sm" onClick={back}>
                {t.tour.back}
              </Button>
            ) : null}
            <Button ref={nextRef} size="sm" onClick={next}>
              {isLast ? t.tour.done : t.tour.next}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
