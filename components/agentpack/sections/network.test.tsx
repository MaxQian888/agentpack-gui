import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { NetworkSection } from "./network"

beforeEach(() => useAppStore.getState().resetPlan())

it("writes registry into plan.network", async () => {
  render(
    <I18nProvider>
      <NetworkSection />
    </I18nProvider>
  )
  await userEvent.type(screen.getByLabelText(/registry/i), "https://m")
  expect(useAppStore.getState().plan.network.npmRegistry).toBe("https://m")
})
