"use client"

import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { SectionShell } from "./section-shell"
import { HelpTip } from "../help-tip"

export function NetworkSection() {
  const t = useT()
  const network = useAppStore((s) => s.plan.network)
  const setNetwork = useAppStore((s) => s.setNetwork)

  return (
    <SectionShell
      title={t.network.title}
      subtitle={t.network.ask}
      help={<HelpTip text={t.help.network} />}
    >
      <Card className="gap-4 p-5">
        <div className="grid gap-2">
          <Label htmlFor="net-base-url">{t.network.baseUrlLabel}</Label>
          <Input
            id="net-base-url"
            placeholder="https://api.example.com"
            value={network.apiBaseUrl ?? ""}
            onChange={(e) => setNetwork({ apiBaseUrl: e.target.value || undefined })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="net-token">{t.network.tokenLabel}</Label>
          <Input
            id="net-token"
            type="password"
            value={network.apiToken ?? ""}
            onChange={(e) => setNetwork({ apiToken: e.target.value || undefined })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="net-registry">{t.network.registryLabel}</Label>
          <Input
            id="net-registry"
            placeholder="https://registry.npmmirror.com"
            value={network.npmRegistry ?? ""}
            onChange={(e) => setNetwork({ npmRegistry: e.target.value || undefined })}
          />
        </div>
      </Card>
    </SectionShell>
  )
}
