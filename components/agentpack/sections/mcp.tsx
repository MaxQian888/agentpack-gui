"use client"

import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { MCP_SERVERS } from "@/lib/agentpack/registry"
import type { AgentTarget } from "@/lib/agentpack/types"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { SectionShell } from "./section-shell"

const TARGETS: AgentTarget[] = ["claude", "codex"]

export function McpSection() {
  const t = useT()
  const mcps = useAppStore((s) => s.plan.mcps)
  const mcpKeys = useAppStore((s) => s.plan.mcpKeys)
  const setMcp = useAppStore((s) => s.setMcp)
  const setMcpKey = useAppStore((s) => s.setMcpKey)

  const targetsFor = (id: string): AgentTarget[] => mcps.find((m) => m.id === id)?.targets ?? []

  const toggleTarget = (id: string, target: AgentTarget) => {
    const current = targetsFor(id)
    const next = current.includes(target)
      ? current.filter((x) => x !== target)
      : [...current, target]
    setMcp(id, next)
  }

  return (
    <SectionShell title={t.mcp.title} subtitle={t.mcp.subtitle}>
      <div className="flex flex-col gap-3">
        {MCP_SERVERS.map((server) => {
          const meta = t.catalog.mcp[server.id]
          const targets = targetsFor(server.id)
          return (
            <Card key={server.id} className="gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="font-medium">{meta?.title ?? server.id}</span>
                  <p className="text-sm text-muted-foreground">{meta?.purpose}</p>
                </div>
                {server.keyEnv ? (
                  <Badge variant="outline" className="shrink-0 font-normal text-muted-foreground">
                    {t.mcp.keySuffix.trim()}
                  </Badge>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-5">
                {TARGETS.map((target) => (
                  <label
                    key={target}
                    className="flex cursor-pointer items-center gap-2 text-sm capitalize"
                  >
                    <Checkbox
                      checked={targets.includes(target)}
                      onCheckedChange={() => toggleTarget(server.id, target)}
                    />
                    {target}
                  </label>
                ))}
              </div>
              {server.keyEnv ? (
                <Input
                  type="password"
                  aria-label={`${server.id} ${server.keyEnv}`}
                  placeholder={server.keyEnv}
                  value={mcpKeys[server.id] ?? ""}
                  onChange={(e) => setMcpKey(server.id, e.target.value)}
                />
              ) : null}
            </Card>
          )
        })}
      </div>
    </SectionShell>
  )
}
