import { render, screen, within } from "@testing-library/react"
import { ThemeProvider } from "next-themes"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { WORKSPACES } from "@/lib/agentpack/workspaces"
import { workspaceMeta } from "@/components/agentpack/sidebar-nav"
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

  it("renders the five task areas", () => {
    renderHome()
    const rail = screen.getByRole("navigation", { name: en.workspaces.nav })
    for (const w of WORKSPACES) {
      expect(
        within(rail).getByRole("button", { name: workspaceMeta(w.key).label(en) })
      ).toBeInTheDocument()
    }
  })

  it("renders the command affordance rather than a run control", () => {
    renderHome()
    expect(screen.getByRole("button", { name: /⌘K/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Run plan/i })).not.toBeInTheDocument()
  })
})
