import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { SkillsSection } from "./skills"

beforeEach(() => useAppStore.getState().resetPlan())

it("checking a target adds the skill with that target", async () => {
  render(
    <I18nProvider>
      <SkillsSection />
    </I18nProvider>
  )
  await userEvent.click(screen.getAllByRole("checkbox")[0])
  const skills = useAppStore.getState().plan.skills
  expect(skills.length).toBeGreaterThan(0)
  expect(skills[0].targets).toContain("claude")
})
