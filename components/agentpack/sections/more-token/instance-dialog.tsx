"use client"

import { useId, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useT } from "@/lib/i18n/provider"
import { bindingChanged } from "@/lib/more-token/binding"
import { credentialState, removeInstance, saveInstance } from "@/lib/more-token/client"
import type {
  MoreTokenInstance,
  MoreTokenInstanceDraft,
  MoreTokenPackage,
} from "@/lib/more-token/types"
import { useConfirm } from "./confirm-dialog"
import { resetInstanceQueries, useForgetCredential } from "./credential"
import { errorText } from "./errors"

/**
 * Add, edit or remove one saved more-token connection — for either package, so
 * a personal connection is as editable and removable as a management one. The
 * caller mounts it with a fresh `key` per opening: the suggested id is minted
 * once per mount, and two adds must not share one (the second save would
 * overwrite the first).
 */
export function InstanceDialog({
  open,
  onOpenChange,
  instance,
  pkg,
  onSaved,
  onRemoved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null adds a new connection of `pkg`; an instance edits that one. */
  instance: MoreTokenInstance | null
  pkg: MoreTokenPackage
  onSaved: (instance: MoreTokenInstance) => void
  onRemoved: () => void
}) {
  const t = useT()
  const m = t.management
  const queryClient = useQueryClient()
  const packageName = instance?.package ?? pkg
  const personal = packageName === "personal"
  const [suggestedId] = useState(
    () => `${personal ? "personal" : "more-token"}-${Date.now().toString(36)}`
  )
  const { confirm, dialog: confirmDialog } = useConfirm()
  const { forget, dialog: forgetDialog } = useForgetCredential()
  const mutation = useMutation({
    mutationFn: async (draft: MoreTokenInstanceDraft) => {
      // Rust drops the stored credential when the address or CA changes, but
      // only locally — the server never hears of it, so the old credential would
      // stay live there. Revoke it first, the same way Remove does: once the
      // binding moves there is nothing left to revoke it with. Declining the
      // local-only fallback keeps the credential, so nothing is saved.
      if (
        instance &&
        bindingChanged(instance, draft) &&
        (await credentialState(instance.id)).connected &&
        !(await forget(instance.id))
      ) {
        return null
      }
      return saveInstance(draft)
    },
    onSuccess: async (saved) => {
      if (!saved) return
      await queryClient.invalidateQueries({ queryKey: ["more-token", "instances"] })
      // Rust deletes the stored credential when the endpoint or the CA changes
      // (the token was issued to the old binding). Mirror that here, or the
      // never-stale credential reading keeps saying "connected".
      if (
        instance &&
        (instance.baseUrl !== saved.baseUrl || instance.caFingerprint !== saved.caFingerprint)
      ) {
        await resetInstanceQueries(queryClient, saved.id)
      }
      onOpenChange(false)
      onSaved(saved)
    },
    onError: (error) => toast.error(errorText(error)),
  })
  const remove = useMutation({
    // Revoke on the server before the record goes: once the instance is gone
    // there is no endpoint left to revoke against.
    mutationFn: async (target: MoreTokenInstance) => {
      if (!(await forget(target.id))) return false
      await removeInstance(target.id)
      return true
    },
    onSuccess: async (removed, target) => {
      if (!removed) return
      queryClient.removeQueries({ queryKey: ["more-token", target.id] })
      await queryClient.invalidateQueries({ queryKey: ["more-token", "instances"] })
      onOpenChange(false)
      onRemoved()
    },
    onError: (error) => toast.error(errorText(error)),
  })
  const requestRemove = async () => {
    if (!instance) return
    const confirmed = await confirm({
      title: m.removeInstanceTitle(instance.name),
      description: m.removeInstanceBody,
      confirmLabel: m.removeInstance,
      cancelLabel: m.cancel,
      destructive: true,
    })
    if (confirmed) remove.mutate(instance)
  }
  const busy = mutation.isPending || remove.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            mutation.mutate({
              id: String(form.get("id")),
              name: String(form.get("name")),
              baseUrl: String(form.get("base_url")),
              readOnly: form.get("read_only") === "on",
              displayCurrency: personal ? null : String(form.get("display_currency") || "") || null,
              package: packageName,
              customCaPath: String(form.get("custom_ca_path") || "") || null,
              clearCustomCa: form.get("clear_custom_ca") === "on",
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>{instance ? m.editInstance : m.addInstance}</DialogTitle>
            <DialogDescription>
              {personal ? t.personal.isolationNote : m.instanceDialogHint}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <InstanceField
              name="id"
              label={m.instanceId}
              defaultValue={instance?.id ?? suggestedId}
              readOnly={!!instance}
              required
              pattern="[A-Za-z0-9_-]+"
            />
            <InstanceField
              name="name"
              label={m.instanceName}
              defaultValue={instance?.name ?? "more-token"}
              required
            />
            <InstanceField
              name="base_url"
              label={m.instanceUrl}
              defaultValue={instance?.baseUrl ?? "https://"}
              required
            />
            <div className="space-y-2">
              <InstanceField name="custom_ca_path" label={m.customCa} />
              {/* The hint belongs to the field it explains, in both packages. */}
              <p className="text-xs text-muted-foreground">{m.customCaHint}</p>
            </div>
            {personal ? null : (
              <InstanceField
                name="display_currency"
                label={m.displayCurrency}
                defaultValue={instance?.displayCurrency ?? ""}
                maxLength={8}
              />
            )}
            <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
              {m.readOnly}
              <Switch name="read_only" defaultChecked={instance?.readOnly} />
            </label>
            {instance?.caFingerprint ? (
              <label className="flex min-h-11 min-w-0 items-center gap-3 text-sm">
                <Checkbox name="clear_custom_ca" />
                <span className="shrink-0">{m.removeCustomCa}</span>
                <code className="truncate font-mono text-xs text-muted-foreground">
                  {instance.caFingerprint.slice(0, 16)}…
                </code>
              </label>
            ) : null}
          </div>
          <DialogFooter className="sm:justify-between">
            {instance ? (
              <Button
                type="button"
                variant="destructive"
                onClick={() => void requestRemove()}
                disabled={busy}
              >
                <Trash2 className="size-4" />
                {remove.isPending ? m.removingInstance : m.removeInstance}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {m.cancel}
              </Button>
              <Button type="submit" disabled={busy}>
                {m.save}
              </Button>
            </div>
          </DialogFooter>
        </form>
        {confirmDialog}
        {forgetDialog}
      </DialogContent>
    </Dialog>
  )
}

function InstanceField({
  label,
  ...props
}: React.ComponentProps<typeof Input> & { label: string; name: string }) {
  const id = useId()
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...props} />
    </div>
  )
}
