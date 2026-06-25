jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/commands", () => ({
  detectCli: jest.fn(async () => ({ installed: true })),
  ccLoadProviders: jest.fn(async () => [
    { id: "1", app_type: "claude", name: "Mine", settings_config: "{}", is_current: false },
  ]),
}))

import { render, screen } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n/provider"
import { RunnerProvider } from "../run/runner-context"
import { useAppStore } from "@/store/app-store"
import { CcSwitchSection } from "./ccswitch"

it("lists providers from the DB", async () => {
  useAppStore.setState({ paths: { ccSwitchSettings: "/x", os: "mac" } as never })
  render(
    <I18nProvider>
      <RunnerProvider>
        <CcSwitchSection />
      </RunnerProvider>
    </I18nProvider>
  )
  expect(await screen.findByText("Mine")).toBeInTheDocument()
})
