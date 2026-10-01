"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTheme } from "next-themes"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { useT } from "@/lib/i18n/provider"
import { useTrayCount } from "./change-tray"
import {
  buildPalette,
  filterPalette,
  type PaletteAction,
  type PaletteItem,
} from "@/lib/agentpack/palette"

export interface PaletteHandlers {
  navigate: (action: Extract<PaletteAction, { kind: "navigate" }>) => void
  quickConfig: () => void
  rescan: () => void
  review: () => void
  showRun: () => void
  onboarding: () => void
  updates: () => void
}

/**
 * The ⌘K palette.
 *
 * Keyboard model, mostly delegated rather than reimplemented: cmdk owns ↑/↓ and
 * Enter, Radix's Dialog owns Esc, the scrim and the focus trap.
 *
 * Focus *restoration* is ours, and has to be. shadcn's `CommandDialog` renders
 * its header as a sibling of `DialogContent` rather than inside it, and Radix's
 * focus scope consequently drops focus to `<body>` when the dialog unmounts —
 * so pressing Esc would leave a keyboard user's next Tab starting from the top
 * of the page, every time. We remember what was focused before opening and put
 * it back.
 *
 * Filtering is ours (`shouldFilter={false}`) so the matching rule is one tested
 * pure function rather than cmdk's built-in scorer — see `lib/agentpack/palette`
 * for why it isn't fuzzy.
 */
export function CommandPalette({
  open,
  onOpenChange,
  pendingChanges,
  running = false,
  handlers,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The change tray's count — what Review would stage. Read from the store when omitted. */
  pendingChanges?: number
  running?: boolean
  handlers: PaletteHandlers
}) {
  const t = useT()
  const { resolvedTheme, setTheme } = useTheme()
  const [query, setQuery] = useState("")
  // What to hand focus back to. Tracked while the palette is CLOSED, because by
  // the time an open-effect could run, Radix has already moved focus inside.
  const restoreTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (open) return
    const remember = () => {
      const el = document.activeElement
      if (el instanceof HTMLElement && el !== document.body) restoreTo.current = el
    }
    remember()
    document.addEventListener("focusin", remember)
    return () => document.removeEventListener("focusin", remember)
  }, [open])

  // Clearing on close is done on the transition, not in an effect reacting to
  // `open`: reopening must never land inside someone else's half-typed search,
  // and an effect for it would cascade a render every time the dialog moves.
  const setOpen = useCallback(
    (next: boolean) => {
      if (!next) {
        setQuery("")
        // After Radix's own unmount focus handling, not before — otherwise it
        // resets us straight back to `<body>`.
        const target = restoreTo.current
        setTimeout(() => target?.focus(), 0)
      }
      onOpenChange(next)
    },
    [onOpenChange]
  )

  const trayCount = useTrayCount()
  const count = pendingChanges ?? trayCount
  const items = useMemo(
    () => buildPalette(t, { pendingChanges: count, running }),
    [t, count, running]
  )
  const matches = useMemo(() => filterPalette(items, query), [items, query])
  const go = matches.filter((i) => i.group === "go")
  const actions = matches.filter((i) => i.group === "action")

  const runItem = (item: PaletteItem) => {
    setOpen(false)
    const a = item.action
    switch (a.kind) {
      case "navigate":
        return handlers.navigate(a)
      case "quickConfig":
        return handlers.quickConfig()
      case "rescan":
        return handlers.rescan()
      case "review":
        return handlers.review()
      case "showRun":
        return handlers.showRun()
      case "toggleTheme":
        return setTheme(resolvedTheme === "dark" ? "light" : "dark")
      case "onboarding":
        return handlers.onboarding()
      case "updates":
        return handlers.updates()
    }
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t.palette.title}
      description={t.palette.description}
      className="top-[18%] translate-y-0"
      shouldFilter={false}
    >
      <CommandInput placeholder={t.palette.placeholder} value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>{t.palette.empty}</CommandEmpty>
        {go.length > 0 ? (
          <CommandGroup heading={t.palette.groupGo}>
            {go.map((item) => (
              <CommandItem key={item.id} value={item.id} onSelect={() => runItem(item)}>
                {/* The destination's name wins the row; its hint gives way.
                    The other way round, a phone read "I." beside a full
                    sentence of description. */}
                <span className="max-w-full shrink-0 truncate">{item.label}</span>
                {item.hint ? (
                  <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">
                    {item.hint}
                  </span>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {actions.length > 0 ? (
          <CommandGroup heading={t.palette.groupActions}>
            {actions.map((item) => (
              <CommandItem key={item.id} value={item.id} onSelect={() => runItem(item)}>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  )
}

/**
 * Bind ⌘K / Ctrl+K globally.
 *
 * Kept out of the component above so the accelerator survives the palette being
 * unmounted, and so a text field can't swallow it — the whole point of ⌘K is
 * that it works from wherever you are, including mid-sentence in a config
 * editor. The one thing it must not do is fight the browser's own ⌘K, hence
 * `preventDefault`.
 */
export function useCommandShortcut(onOpen: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "k" && e.key !== "K") return
      if (!e.metaKey && !e.ctrlKey) return
      e.preventDefault()
      onOpen()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onOpen])
}
