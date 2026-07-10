import { CC_CONNECT_DEFAULT_PORT, parseManagementPort, webUiUrl } from "./ccconnect"

describe("parseManagementPort", () => {
  it('defaults on an empty config (missing file reads as "")', () => {
    expect(parseManagementPort("")).toBe(CC_CONNECT_DEFAULT_PORT)
  })

  it("defaults on unparseable TOML", () => {
    expect(parseManagementPort("this is [not toml")).toBe(CC_CONNECT_DEFAULT_PORT)
  })

  it("defaults when the management table has no port", () => {
    expect(parseManagementPort("[management]\nenable = true\n")).toBe(CC_CONNECT_DEFAULT_PORT)
  })

  it("reads a custom port from [management]", () => {
    expect(parseManagementPort('[management]\nport = 8080\ntoken = "x"\n')).toBe(8080)
  })

  it("ignores a port under a different table", () => {
    expect(parseManagementPort("[server]\nport = 8080\n")).toBe(CC_CONNECT_DEFAULT_PORT)
  })

  it("rejects non-integer and out-of-range ports", () => {
    expect(parseManagementPort('[management]\nport = "9820"\n')).toBe(CC_CONNECT_DEFAULT_PORT)
    expect(parseManagementPort("[management]\nport = 9820.5\n")).toBe(CC_CONNECT_DEFAULT_PORT)
    expect(parseManagementPort("[management]\nport = 0\n")).toBe(CC_CONNECT_DEFAULT_PORT)
    expect(parseManagementPort("[management]\nport = 70000\n")).toBe(CC_CONNECT_DEFAULT_PORT)
  })
})

it("webUiUrl always targets localhost", () => {
  expect(webUiUrl(9820)).toBe("http://localhost:9820")
  expect(webUiUrl(8080)).toBe("http://localhost:8080")
})
