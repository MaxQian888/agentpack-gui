import { bindingChanged, normalizeBaseUrl } from "./binding"
import type { MoreTokenInstance, MoreTokenInstanceDraft } from "./types"

const instance: MoreTokenInstance = {
  id: "primary",
  name: "Primary",
  baseUrl: "https://more-token.example",
  caFingerprint: null,
  readOnly: false,
  displayCurrency: null,
  package: "management",
}

const draft = (overrides: Partial<MoreTokenInstanceDraft> = {}): MoreTokenInstanceDraft => ({
  id: instance.id,
  name: instance.name,
  baseUrl: instance.baseUrl,
  readOnly: false,
  displayCurrency: null,
  customCaPath: null,
  clearCustomCa: false,
  package: "management",
  ...overrides,
})

it("normalizes the address the way Rust stores it", () => {
  expect(normalizeBaseUrl(" https://More-Token.example/ ")).toBe("https://more-token.example")
  expect(normalizeBaseUrl("https://more-token.example:443")).toBe("https://more-token.example")
  expect(normalizeBaseUrl("http://127.0.0.1:3001/")).toBe("http://127.0.0.1:3001")
  expect(normalizeBaseUrl("http://more-token.example")).toBeNull()
  expect(normalizeBaseUrl("https://more-token.example/api")).toBeNull()
  expect(normalizeBaseUrl("not a url")).toBeNull()
})

it("counts a real address or CA change, and nothing else", () => {
  expect(bindingChanged(instance, draft({ name: "Renamed", readOnly: true }))).toBe(false)
  expect(bindingChanged(instance, draft({ baseUrl: "https://more-token.example/" }))).toBe(false)
  expect(bindingChanged(instance, draft({ baseUrl: "https://other.example" }))).toBe(true)
  expect(bindingChanged(instance, draft({ customCaPath: "/tmp/ca.pem" }))).toBe(true)
  expect(bindingChanged(instance, draft({ clearCustomCa: true }))).toBe(false)
  expect(
    bindingChanged({ ...instance, caFingerprint: "ab12" }, draft({ clearCustomCa: true }))
  ).toBe(true)
  // An address Rust will refuse is the save's own error, not a rebinding.
  expect(bindingChanged(instance, draft({ baseUrl: "https://other.example/path" }))).toBe(false)
})
