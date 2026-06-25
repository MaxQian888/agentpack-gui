import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { RunnerProvider } from "../run/runner-context"
import { useAppStore } from "@/store/app-store"
import { SkillsSection } from "./skills"

beforeEach(() => useAppStore.getState().resetPlan())

function renderSkills() {
  return render(
    <I18nProvider>
      <RunnerProvider>
        <SkillsSection />
      </RunnerProvider>
    </I18nProvider>
  )
}

it("checking a target adds the skill with that target", async () => {
  renderSkills()
  await userEvent.click(screen.getAllByRole("checkbox")[0])
  const skills = useAppStore.getState().plan.skills
  expect(skills.length).toBeGreaterThan(0)
  expect(skills[0].targets).toContain("claude")
})

it("reveals install/uninstall actions once a target is selected", async () => {
  renderSkills()
  expect(screen.queryByRole("button", { name: /Install now/i })).not.toBeInTheDocument()
  await userEvent.click(screen.getAllByRole("checkbox")[0])
  expect(screen.getAllByRole("button", { name: /Install now/i }).length).toBeGreaterThan(0)
})
