let mockTauri = true
jest.mock("@/lib/tauri", () => ({ isTauri: () => mockTauri }))
jest.mock("../../../model-prices", () => ({ syncModelPrices: jest.fn(async () => true) }))

import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { useAppStore } from "@/store/app-store"
import { syncModelPrices } from "../../../model-prices"
import { PriceSync } from "./price-sync"

const p = en.history.prices
const renderLine = (unpriced?: React.ComponentProps<typeof PriceSync>["unpriced"]) =>
  render(
    <I18nProvider>
      <PriceSync unpriced={unpriced} />
    </I18nProvider>
  )

beforeEach(() => {
  mockTauri = true
  jest.clearAllMocks()
  useAppStore.setState({
    paths: { home: "/h" } as never,
    priceSync: { fetchedAt: null, models: 0, status: "idle", error: null },
  })
})

it("says the built-in table is all there is until a sync lands", () => {
  renderLine()
  expect(screen.getByText(p.builtin)).toBeInTheDocument()
})

it("names the source, the count and the date once synced", () => {
  const at = Date.UTC(2026, 9, 12, 8)
  useAppStore.setState({ priceSync: { fetchedAt: at, models: 264, status: "idle", error: null } })
  renderLine()
  expect(screen.getByText(p.synced(new Date(at).toLocaleString(), 264))).toBeInTheDocument()
})

it("syncs on demand, and shows it working", async () => {
  renderLine()
  await userEvent.click(screen.getByRole("button", { name: p.syncNow }))
  expect(syncModelPrices).toHaveBeenCalledWith("/h")
  act(() =>
    useAppStore.setState({
      priceSync: { fetchedAt: null, models: 0, status: "syncing", error: null },
    })
  )
  expect(await screen.findByRole("button", { name: p.syncing })).toBeDisabled()
})

it("says a failed sync left the existing prices in place", () => {
  useAppStore.setState({ priceSync: { fetchedAt: 1, models: 3, status: "failed", error: "HTTP 503" } }) // prettier-ignore
  renderLine()
  expect(screen.getByRole("status")).toHaveTextContent(p.failed("HTTP 503"))
})

it("names the heaviest unpriced models and counts the rest", () => {
  const m = (model: string) => ({ model, transcripts: 1, tokens: 1 })
  renderLine(["a", "b", "c", "d", "e", "f"].map(m))
  expect(screen.getByText(p.unpriced("a, b, c, d", 2))).toBeInTheDocument()
})

it("offers no sync in web mode, and says why", () => {
  mockTauri = false
  renderLine()
  expect(screen.queryByRole("button")).toBeNull()
  expect(screen.getByText(p.desktopOnly)).toBeInTheDocument()
})
