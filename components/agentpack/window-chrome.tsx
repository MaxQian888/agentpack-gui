"use client"

import { useEffect, useState } from "react"
import { Copy, Minus, Square, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { detectOs } from "@/lib/tauri/os"
import {
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  onWindowResized,
  toggleMaximizeWindow,
} from "@/lib/tauri/window"
import { useT } from "@/lib/i18n/provider"

/**
 * How the window frame is drawn, which decides what the shell has to reserve
 * space for:
 *
 * - `none`   — web mode (`pnpm dev`), or the platform isn't resolved yet. The
 *              layout is exactly what it was before frameless support.
 * - `macos`  — decorated window with `titleBarStyle: "Overlay"`, so the *native*
 *              traffic lights float over our content (see tauri.macos.conf.json).
 *              We draw no buttons, we just keep the top-left corner clear.
 * - `custom` — Windows/Linux, `decorations: false`. We draw minimize / maximize
 *              / close ourselves.
 *
 * Edge-resizing needs no work from us on either undecorated platform: tao
 * hit-tests the borders on Windows (WM_NCHITTEST) and calls `begin_resize_drag`
 * on GTK.
 */
export type WindowChrome = "none" | "macos" | "custom"

/**
 * Top padding the sidebar takes on macOS so its brand block clears the native
 * traffic lights. They are pinned at `trafficLightPosition` y=18 in
 * tauri.macos.conf.json and are ~14px tall, so 44px leaves a clear gap. Applied
 * to the sidebar (not the header) because the lights sit over the top-left
 * corner, which is the sidebar's.
 */
export const MACOS_TRAFFIC_LIGHT_INSET = "pt-11"

export function useWindowChrome(): WindowChrome {
  const [chrome, setChrome] = useState<WindowChrome>("none")

  useEffect(() => {
    let alive = true
    void detectOs().then((os) => {
      if (!alive || !os) return
      setChrome(os === "mac" ? "macos" : "custom")
    })
    return () => {
      alive = false
    }
  }, [])

  return chrome
}

/**
 * Minimize / maximize / close for the undecorated Windows & Linux window.
 * Renders nothing on macOS (the system draws the traffic lights) or in web mode.
 *
 * These are `<button>`s, which Tauri's drag script treats as non-draggable, so
 * they keep working inside the header's `data-tauri-drag-region="deep"`.
 */
export function WindowControls({ chrome }: { chrome: WindowChrome }) {
  const t = useT()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (chrome !== "custom") return
    let alive = true
    const sync = () => {
      void isWindowMaximized().then((m) => {
        if (alive) setMaximized(m)
      })
    }
    sync()
    // Tauri emits no maximize/restore event — a resize is the only signal.
    let unlisten: (() => void) | undefined
    void onWindowResized(sync).then((fn) => {
      if (alive) unlisten = fn
      else fn()
    })
    return () => {
      alive = false
      unlisten?.()
    }
  }, [chrome])

  if (chrome !== "custom") return null

  const btn =
    "flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"

  return (
    // `-my-3` cancels the header's `py-3` so the buttons span its full height,
    // the way native window controls do.
    <div className="-my-3 flex self-stretch">
      <button
        type="button"
        className={btn}
        aria-label={t.shell.minimize}
        title={t.shell.minimize}
        onClick={() => void minimizeWindow()}
      >
        <Minus className="size-4" />
      </button>
      <button
        type="button"
        className={btn}
        aria-label={maximized ? t.shell.restore : t.shell.maximize}
        title={maximized ? t.shell.restore : t.shell.maximize}
        onClick={() => void toggleMaximizeWindow()}
      >
        {maximized ? <Copy className="size-3.5" /> : <Square className="size-3.5" />}
      </button>
      <button
        type="button"
        className={cn(btn, "hover:bg-destructive hover:text-white")}
        aria-label={t.shell.closeWindow}
        title={t.shell.closeWindow}
        onClick={() => void closeWindow()}
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
