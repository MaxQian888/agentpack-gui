"use client"

import { useCallback, useRef, useState, type ReactNode } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export interface ConfirmRequest {
  title: string
  /** The consequence, stated — not "Are you sure?". */
  description: ReactNode
  confirmLabel: string
  cancelLabel: string
  destructive?: boolean
}

/**
 * `window.confirm` as an in-app AlertDialog: `await confirm(request)` resolves
 * true only when the confirm button is pressed, false on Cancel, Esc or the
 * overlay. The native prompt can't be styled, can't be translated past its
 * buttons, and in the desktop WebView reads as a different app asking. Render
 * `dialog` once, anywhere in the caller's tree.
 */
export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const resolver = useRef<((value: boolean) => void) | null>(null)
  const settle = (value: boolean) => {
    resolver.current?.(value)
    resolver.current = null
    setRequest(null)
  }
  const confirm = useCallback(
    (next: ConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false)
        resolver.current = resolve
        setRequest(next)
      }),
    []
  )
  const dialog = (
    <AlertDialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) settle(false)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          <AlertDialogDescription>{request?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{request?.cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            variant={request?.destructive ? "destructive" : "default"}
            onClick={() => settle(true)}
          >
            {request?.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
  return { confirm, dialog }
}
