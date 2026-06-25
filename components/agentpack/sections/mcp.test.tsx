import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { McpSection } from "./mcp"

beforeEach(() => useAppStore.getState().resetPlan())

it("entering a key stores it under the server id", async () => {
  render(
    <I18nProvider>
      <McpSection />
    </I18nProvider>
  )
  const key = await screen.findByLabelText(/context7/i)
  await userEvent.type(key, "abc")
  expect(useAppStore.getState().plan.mcpKeys.context7).toBe("abc")
})

it("toggling a target adds the server to the plan", async () => {
  render(
    <I18nProvider>
      <McpSection />
    </I18nProvider>
  )
  await userEvent.click(screen.getAllByRole("checkbox")[0])
  expect(useAppStore.getState().plan.mcps.length).toBeGreaterThan(0)
})
