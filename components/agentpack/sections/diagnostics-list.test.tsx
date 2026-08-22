import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { DiagnosticsList } from "./diagnostics-list"
import type { DiagnosticAction, DiagnosticItem } from "@/lib/agentpack/diagnostics"

const g = en.diagnostics

const item = (
  id: string,
  run: DiagnosticAction,
  over: Partial<DiagnosticItem> = {}
): DiagnosticItem => ({
  id,
  severity: over.severity ?? "info",
  category: over.category ?? "dependency",
  title: over.title ?? id,
  detail: over.detail,
  destination: over.destination ?? "clis",
  action: { label: over.action?.label ?? "Upgrade", run },
})

const UPGRADES = [
  item("upgrade-a", { kind: "upgradeCli", id: "a" }, { title: "Tool A 2.0 is out" }),
  item("upgrade-b", { kind: "upgradeCli", id: "b" }, { title: "Tool B 3.0 is out" }),
]
const RESTORE = item(
  "config-claudeSettings",
  { kind: "restoreFile", path: "/h/settings.json" },
  { title: "Claude settings is gone", severity: "critical", category: "config" }
)
const NAVIGATE = item(
  "network-unreachable",
  { kind: "navigate" },
  { title: "Nothing was reachable", severity: "warning", category: "network" }
)

function renderList(items: DiagnosticItem[], withBatch = true) {
  const onAct = jest.fn()
  const onBatch = jest.fn()
  render(
    <I18nProvider>
      <DiagnosticsList items={items} onAct={onAct} {...(withBatch ? { onBatch } : {})} />
    </I18nProvider>
  )
  return { onAct, onBatch, user: userEvent.setup() }
}

const tick = (title: string) => screen.getByRole("checkbox", { name: g.selectRow(title) })

it("renders nothing at all when there is nothing to say", () => {
  const { container } = render(
    <I18nProvider>
      <DiagnosticsList items={[]} onAct={jest.fn()} />
    </I18nProvider>
  )
  expect(container).toBeEmptyDOMElement()
})

it("still gives every row its own single action", async () => {
  const { onAct, user } = renderList([...UPGRADES, NAVIGATE])
  const rows = screen.getAllByRole("listitem")
  expect(rows).toHaveLength(3)
  await user.click(within(rows[0]).getByRole("button"))
  expect(onAct).toHaveBeenCalledWith(UPGRADES[0])
})

it("offers a tick box only on the rows whose repair can be shared", () => {
  renderList([...UPGRADES, RESTORE, NAVIGATE])
  expect(screen.getAllByRole("checkbox")).toHaveLength(3)
  // A navigate isn't a repair, so there is nothing to batch it with.
  expect(
    screen.queryByRole("checkbox", { name: g.selectRow("Nothing was reachable") })
  ).not.toBeInTheDocument()
})

it("draws no tick boxes at all when no batch handler was given", () => {
  // A checkbox that leads to no action is a control that does nothing.
  renderList(UPGRADES, false)
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0)
})

it("says nothing until a selection is actually a batch", async () => {
  const { user } = renderList([...UPGRADES, RESTORE])
  expect(screen.queryByText(g.selected(1))).not.toBeInTheDocument()
  // One tick is what the row's own button already does.
  await user.click(tick("Tool A 2.0 is out"))
  expect(screen.queryByRole("button", { name: g.batch["upgrade-cli"](1) })).not.toBeInTheDocument()
})

it("names exactly what the batch will do, and hands it over on click", async () => {
  const { onBatch, user } = renderList([...UPGRADES, RESTORE])
  await user.click(tick("Tool A 2.0 is out"))
  await user.click(tick("Tool B 3.0 is out"))
  expect(screen.getByText(g.selected(2))).toBeInTheDocument()

  await user.click(screen.getByRole("button", { name: g.batch["upgrade-cli"](2) }))
  expect(onBatch).toHaveBeenCalledTimes(1)
  expect(onBatch.mock.calls[0][0]).toEqual({
    key: "upgrade-cli",
    items: UPGRADES,
  })
})

it("withdraws the offer when the picks stop sharing one repair", async () => {
  // There is no honest sentence for "upgrade this and restore that", so there
  // is no button — rather than one describing half of what it does.
  const { user } = renderList([...UPGRADES, RESTORE])
  await user.click(tick("Tool A 2.0 is out"))
  await user.click(tick("Tool B 3.0 is out"))
  await user.click(tick("Claude settings is gone"))
  expect(screen.queryByRole("button", { name: g.batch["upgrade-cli"](3) })).not.toBeInTheDocument()
  expect(screen.queryByText(g.selected(3))).not.toBeInTheDocument()
})

it("clears the selection after running it, so a second click can't repeat it", async () => {
  const { user } = renderList(UPGRADES)
  await user.click(tick("Tool A 2.0 is out"))
  await user.click(tick("Tool B 3.0 is out"))
  await user.click(screen.getByRole("button", { name: g.batch["upgrade-cli"](2) }))
  expect(screen.queryByText(g.selected(2))).not.toBeInTheDocument()
  expect(tick("Tool A 2.0 is out")).not.toBeChecked()
})

it("clears the selection on request without running anything", async () => {
  const { onBatch, user } = renderList(UPGRADES)
  await user.click(tick("Tool A 2.0 is out"))
  await user.click(tick("Tool B 3.0 is out"))
  await user.click(screen.getByRole("button", { name: g.clearSelection }))
  expect(onBatch).not.toHaveBeenCalled()
  expect(screen.queryByText(g.selected(2))).not.toBeInTheDocument()
})

it("unticks a row that is clicked twice", async () => {
  const { user } = renderList(UPGRADES)
  await user.click(tick("Tool A 2.0 is out"))
  await user.click(tick("Tool A 2.0 is out"))
  expect(tick("Tool A 2.0 is out")).not.toBeChecked()
})

it("drops a tick left behind on a finding a rescan removed", async () => {
  // Otherwise the stale id blocks the button for the rows that are still there,
  // and the user sees two ticked rows with no way to act on them.
  const onAct = jest.fn()
  const onBatch = jest.fn()
  const user = userEvent.setup()
  const { rerender } = render(
    <I18nProvider>
      <DiagnosticsList items={[...UPGRADES, RESTORE]} onAct={onAct} onBatch={onBatch} />
    </I18nProvider>
  )
  await user.click(tick("Tool A 2.0 is out"))
  await user.click(tick("Tool B 3.0 is out"))
  await user.click(tick("Claude settings is gone"))

  rerender(
    <I18nProvider>
      <DiagnosticsList items={UPGRADES} onAct={onAct} onBatch={onBatch} />
    </I18nProvider>
  )
  expect(screen.getByRole("button", { name: g.batch["upgrade-cli"](2) })).toBeInTheDocument()
})

it("keeps the list ranked by severity while a batch is assembled", () => {
  // Grouping by category instead would put the blocking finding underneath the
  // optional one.
  renderList([RESTORE, NAVIGATE, ...UPGRADES])
  const titles = screen.getAllByRole("listitem").map((row) => row.querySelector("p")?.textContent)
  expect(titles).toEqual([
    "Claude settings is gone",
    "Nothing was reachable",
    "Tool A 2.0 is out",
    "Tool B 3.0 is out",
  ])
})

it("names a restore batch as restores, not as upgrades", async () => {
  const second = item(
    "config-codexConfig",
    { kind: "restoreFile", path: "/h/config.toml" },
    { title: "Codex config is gone", severity: "critical", category: "config" }
  )
  const { onBatch, user } = renderList([RESTORE, second])
  await user.click(tick("Claude settings is gone"))
  await user.click(tick("Codex config is gone"))
  await user.click(screen.getByRole("button", { name: g.batch["restore-config"](2) }))
  expect(onBatch.mock.calls[0][0].key).toBe("restore-config")
})
