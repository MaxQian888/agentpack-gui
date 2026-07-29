import {
  accountsPath,
  captureAccount,
  emptyAccountStore,
  missingPicks,
  parseAccounts,
  resolveAccount,
  serializeAccounts,
} from "./accounts"
import type { Provider, ProviderApp } from "./types"

const row = (id: string, app: ProviderApp, is_current = false): Provider => ({
  id,
  app_type: app,
  name: id,
  settings_config: "{}",
  is_current,
})

it("nests under ~/.agentpack beside the setup profiles", () => {
  expect(accountsPath("/home/me")).toBe("/home/me/.agentpack/accounts.json")
})

it("captures the current provider of every app", () => {
  const providers = [
    row("a", "claude", true),
    row("b", "claude"),
    row("c", "codex", true),
    row("d", "opencode"),
  ]
  expect(captureAccount("p1", "Work", providers)).toEqual({
    id: "p1",
    name: "Work",
    // opencode has no current row, so the profile simply doesn't speak for it.
    picks: { claude: "a", codex: "c" },
  })
})

it("serialize → parse round-trips", () => {
  const store = {
    version: 1 as const,
    profiles: [captureAccount("p1", "Work", [row("a", "claude", true)])],
  }
  expect(parseAccounts(serializeAccounts(store))).toEqual(store)
})

it("degrades to an empty store on invalid input", () => {
  expect(parseAccounts("")).toEqual(emptyAccountStore())
  expect(parseAccounts("{not json")).toEqual(emptyAccountStore())
  expect(parseAccounts(JSON.stringify({ nope: 1 }))).toEqual(emptyAccountStore())
})

it("drops entries missing an id or name, and non-string picks", () => {
  const json = JSON.stringify({
    profiles: [
      { id: "ok", name: "Ok", picks: { claude: "a", codex: 7 } },
      { name: "no-id" },
      { id: "no-name" },
    ],
  })
  const out = parseAccounts(json)
  expect(out.profiles).toHaveLength(1)
  expect(out.profiles[0].picks).toEqual({ claude: "a" })
})

it("resolves only the rows that actually need switching", () => {
  const providers = [row("a", "claude", true), row("b", "codex")]
  const profile = { id: "p1", name: "Work", picks: { claude: "a", codex: "b" } }
  // claude is already current — applying twice must not queue redundant writes,
  // each of which would take its own backup snapshot.
  expect(resolveAccount(profile, providers).map((p) => p.id)).toEqual(["b"])
})

it("still applies the apps it can when a picked provider was deleted", () => {
  const providers = [row("b", "codex")]
  const profile = { id: "p1", name: "Work", picks: { claude: "gone", codex: "b" } }
  expect(resolveAccount(profile, providers).map((p) => p.id)).toEqual(["b"])
  expect(missingPicks(profile, providers)).toEqual(["claude"])
})

it("reports no missing picks for a fully resolvable profile", () => {
  const providers = [row("a", "claude"), row("b", "codex")]
  expect(
    missingPicks({ id: "p", name: "n", picks: { claude: "a", codex: "b" } }, providers)
  ).toEqual([])
})
