"use client"

import { useEffect, useState } from "react"
import { ExternalLink, Loader2, RotateCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useT } from "@/lib/i18n/provider"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * The full dashboard URL **including the login token** — what the frame loads.
   * Never rendered as text; the toolbar shows `displayUrl` instead.
   */
  url: string
  /** Token-free `http://localhost:<port>`, safe to put on screen. */
  displayUrl: string
  /** Hands the same page to the user's real browser. */
  onOpenExternal: () => void
}

/** How long a blank frame is given before we offer the escape hatches. */
const LOAD_TIMEOUT_MS = 8000

/**
 * The frame itself, split out so the parent can remount it with a `key`.
 *
 * Reload has to be a remount: re-assigning an identical `src` does not
 * re-navigate a frame, and the document inside is cross-origin, so we cannot
 * reach into it and call `location.reload()` either. Mounting a new element is
 * the only reload available to us — and it conveniently resets this component's
 * own load state at the same time.
 */
function DashboardFrame({
  url,
  title,
  loadingLabel,
  stalledLabel,
  reloadLabel,
  externalLabel,
  onReload,
  onOpenExternal,
}: {
  url: string
  title: string
  loadingLabel: string
  stalledLabel: string
  reloadLabel: string
  externalLabel: string
  onReload: () => void
  onOpenExternal: () => void
}) {
  const [loaded, setLoaded] = useState(false)
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    const id = setTimeout(() => setSlow(true), LOAD_TIMEOUT_MS)
    return () => clearTimeout(id)
  }, [])

  return (
    <div className="relative min-h-0 flex-1">
      <iframe
        src={url}
        title={title}
        className="size-full border-0 bg-background"
        // `allow-same-origin` keeps the frame on its own origin so the SPA can
        // reach its API and its (partitioned) storage. Paired with
        // `allow-scripts` that would be self-defeating for *same*-origin content
        // — it could drop its own sandbox — but this frame is cross-origin, so
        // the grant buys the dashboard nothing against us. What the list
        // withholds is the part that matters: no `allow-top-navigation`, so a
        // page on a port we did not choose cannot steer the app window away.
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
        onLoad={() => setLoaded(true)}
      />
      {loaded ? null : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background">
          {slow ? (
            <>
              <p className="max-w-sm text-center text-sm text-muted-foreground">{stalledLabel}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="gap-1" onClick={onReload}>
                  <RotateCw className="size-3.5" />
                  {reloadLabel}
                </Button>
                <Button variant="outline" size="sm" className="gap-1" onClick={onOpenExternal}>
                  <ExternalLink className="size-3.5" />
                  {externalLabel}
                </Button>
              </div>
            </>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {loadingLabel}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * cc-connect's management dashboard, embedded in the app instead of handed to
 * the user's browser.
 *
 * **Why an iframe and not a second Tauri window.** The dashboard is a whole SPA;
 * a window would put it beside the app, which is the same context switch as the
 * browser, only with worse window management. A frame keeps it inside the
 * workspace it belongs to. The cost is that the frame is a cross-origin,
 * third-party browsing context — see the sandbox note above, and the `frame-src`
 * entry in `tauri.conf.json`, which is what makes this render at all.
 *
 * **Why the token goes in the URL every time.** The SPA authenticates from
 * `?token=` on `/login` and remembers it in `localStorage`. A framed page's
 * storage is partitioned per embedding site, so what it remembers here is *not*
 * what the same dashboard remembers in the user's browser. Passing the token on
 * every load is what makes the embed work from an empty partition.
 *
 * **The one case that still needs a reload.** The SPA prefers its remembered
 * token over the one we hand it: `/login` redirects to the dashboard whenever
 * storage says "authenticated", so the `?token=` effect never runs. If that
 * remembered token has since gone stale — the user edited `management.token`,
 * or recreated a config.toml and got a fresh one — the dashboard 401s, logs
 * itself out and lands on its own login form. It has cleared the bad token by
 * then, so Reload (which remounts, below) authenticates. We cannot detect the
 * state to do it automatically: the frame is cross-origin, so its URL, its
 * storage and its network results are all closed to us. Hence Reload is a
 * first-class control here rather than an afterthought, and the stalled copy
 * names the symptom.
 */
export function CcConnectDashboardFrame({
  open,
  onOpenChange,
  url,
  displayUrl,
  onOpenExternal,
}: Props) {
  const t = useT()
  const c = t.ccconnect
  const [frameKey, setFrameKey] = useState(0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[92vh] w-[96vw] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        {/* The frame is the surface; the heading exists for screen readers. */}
        <DialogHeader className="sr-only">
          <DialogTitle>{c.embedTitle}</DialogTitle>
          <DialogDescription>{c.embedDescription(displayUrl)}</DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{c.embedTitle}</div>
            <div className="truncate font-mono text-xs text-muted-foreground">{displayUrl}</div>
          </div>
          {/* The one failure the frame can show us nothing about — see the note
              on the component. Cheap to say here, and it is the only place the
              user is looking when it happens. */}
          <p className="hidden max-w-xs text-right text-xs text-muted-foreground lg:block">
            {c.embedLoginHint}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1"
            onClick={() => setFrameKey((k) => k + 1)}
          >
            <RotateCw className="size-3.5" />
            {c.embedReload}
          </Button>
          <Button variant="ghost" size="sm" className="gap-1" onClick={onOpenExternal}>
            <ExternalLink className="size-3.5" />
            {c.embedExternal}
          </Button>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {c.embedClose}
          </Button>
        </div>

        <DashboardFrame
          key={frameKey}
          url={url}
          title={c.embedTitle}
          loadingLabel={c.embedLoading}
          stalledLabel={c.embedStalled}
          reloadLabel={c.embedReload}
          externalLabel={c.embedExternal}
          onReload={() => setFrameKey((k) => k + 1)}
          onOpenExternal={onOpenExternal}
        />
      </DialogContent>
    </Dialog>
  )
}
