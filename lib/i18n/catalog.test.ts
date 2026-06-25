import { en } from "./en"
import { zhCN } from "./zh-CN"

/**
 * Every function-valued message is a pure string template. Walk both catalogs
 * and invoke each one so a missing placeholder or a throwing template surfaces
 * in CI (and so the templates are exercised for coverage).
 */
function invokeAll(obj: unknown, path = ""): string[] {
  const fns: string[] = []
  if (typeof obj === "function") {
    const out = (obj as (...a: unknown[]) => unknown)("x", 2, 3)
    expect(typeof out).toBe("string")
    expect(out).not.toContain("undefined")
    fns.push(path)
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) fns.push(...invokeAll(v, `${path}.${k}`))
  }
  return fns
}

it("every en template renders to a string without 'undefined'", () => {
  const fns = invokeAll(en)
  expect(fns.length).toBeGreaterThan(20)
})

it("every zh-CN template renders to a string without 'undefined'", () => {
  expect(invokeAll(zhCN).length).toBeGreaterThan(20)
})
