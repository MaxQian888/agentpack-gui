import { expect, test } from "@playwright/test"

test("docs home redirects to the generated Getting Started page", async ({ page }) => {
  await page.goto("/")

  await expect(page).toHaveURL(/\/docs\/?$/)
  await expect(
    page.getByRole("article").getByRole("heading", { name: "Getting Started", exact: true })
  ).toBeVisible()
  await expect(page.getByText("Welcome to the agentpack-gui documentation.")).toBeVisible()
})

test("shows the generated page in the sidebar and renders its MDX content", async ({ page }) => {
  await page.goto("/docs")

  const sidebar = page.getByRole("complementary")
  await expect(sidebar.getByRole("link", { name: "Getting Started" })).toBeVisible()
  await sidebar.getByRole("link", { name: "Getting Started" }).click()
  await expect(page).toHaveURL(/\/docs\/?$/)
  const article = page.getByRole("article")
  await expect(article.getByRole("heading", { name: "Provider storage" })).toBeVisible()
  await expect(article.getByText(/two isolated storage backends/)).toBeVisible()
  await expect(
    article.getByRole("heading", { name: "more-token personal workspace" })
  ).toBeVisible()
  await expect(article.getByText(/personal desktop credential/)).toBeVisible()
})

test("unknown documentation pages return a visible 404", async ({ page }) => {
  const response = await page.goto("/docs/page-that-does-not-exist")

  expect(response?.status()).toBe(404)
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "This page could not be found." })).toBeVisible()
})
