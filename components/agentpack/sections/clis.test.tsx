jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/commands", () => ({
  detectCli: jest.fn(async () => ({ installed: true, version: "1.2.3" })),
}))

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { ClisSection } from "./clis"

beforeEach(() => useAppStore.getState().resetPlan())

it("shows detected version and toggles selection", async () => {
  render(
    <I18nProvider>
      <ClisSection />
    </I18nProvider>
  )
  expect(await screen.findAllByText(/1\.2\.3/)).not.toHaveLength(0)
  await userEvent.click(screen.getAllByRole("checkbox")[0])
  expect(useAppStore.getState().plan.clis.length).toBeGreaterThan(0)
})
