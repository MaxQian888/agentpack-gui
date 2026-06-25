import { en } from "./en"
import { zhCN } from "./zh-CN"
import { CLI_TOOLS, SKILLS, MCP_SERVERS } from "@/lib/agentpack/registry"

function keys(o: object): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === "object" && typeof v !== "function" ? keys(v).map((s) => `${k}.${s}`) : [k]
  )
}

it("zh-CN structurally matches en", () => {
  expect(keys(zhCN).sort()).toEqual(keys(en).sort())
})

it("every registry id has catalog entries in both locales", () => {
  for (const c of CLI_TOOLS) for (const m of [en, zhCN]) expect(m.catalog.cli[c.id]).toBeDefined()
  for (const s of SKILLS) for (const m of [en, zhCN]) expect(m.catalog.skills[s.id]).toBeDefined()
  for (const s of MCP_SERVERS) for (const m of [en, zhCN]) expect(m.catalog.mcp[s.id]).toBeDefined()
})
