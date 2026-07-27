"use client"

import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"

/**
 * Custom API endpoint for the agent CLIs (an LLM gateway or a relay). Applied by
 * a run, which writes Claude Code's `env` block and a Codex model provider.
 */
export function RelayCard() {
  const t = useT()
  const network = useAppStore((s) => s.plan.network)
  const setNetwork = useAppStore((s) => s.setNetwork)

  return (
    <Card className="gap-4 p-5">
      <div>
        <h3 className="font-medium">{t.network.relay.title}</h3>
        <p className="text-sm text-muted-foreground">{t.network.relay.subtitle}</p>
      </div>
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
    </Card>
  )
}
