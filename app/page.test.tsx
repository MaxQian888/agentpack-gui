import { render, screen } from "@testing-library/react"
import { ThemeProvider } from "next-themes"
import { I18nProvider } from "@/lib/i18n/provider"
import Home from "./page"

function renderHome() {
  return render(
    <ThemeProvider attribute="class">
      <I18nProvider>
        <Home />
      </I18nProvider>
    </ThemeProvider>
  )
}

describe("Home Page (agentpack shell)", () => {
  it("renders the brand and tagline", () => {
    renderHome()
    expect(screen.getByText("agentpack")).toBeInTheDocument()
  })

  it("renders the sidebar sections", () => {
    renderHome()
    expect(screen.getByRole("button", { name: /Quick setup/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /cc-switch management/i })).toBeInTheDocument()
  })

  it("renders the run-plan action", () => {
    renderHome()
    expect(screen.getByRole("button", { name: /Run plan/i })).toBeInTheDocument()
  })
})
