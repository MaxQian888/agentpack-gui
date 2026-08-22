import { en } from "@/lib/i18n/en"
import { zhCN } from "@/lib/i18n/zh-CN"
import { diagnoseFailure, groupFailures } from "./failure"
import type { StepReport } from "./types"

const f = en.failure

const failed = (over: Partial<StepReport> = {}): StepReport => ({
  id: over.id ?? "cli-claude-code",
  label: over.label ?? "Install Claude Code",
  status: "error",
  output: over.output ?? [],
  error: over.error,
})

const read = (lines: string[], over: Partial<StepReport> = {}) =>
  diagnoseFailure(en, failed({ output: lines, ...over }))

describe("what is worth diagnosing", () => {
  it("says nothing about a step that didn't fail", () => {
    for (const status of ["done", "warning", "skipped", "pending", "running"] as const) {
      // A skipped step failed only because something before it did, so a
      // reading here would put the blame two rows below where it belongs.
      expect(diagnoseFailure(en, { ...failed(), status })).toBeNull()
    }
  })

  it("reads the error the runner recorded, not only the command's output", () => {
    const d = read([], { error: "npm ERR! code EBADENGINE" })!
    expect(d.cause).toBe("nodeTooOld")
  })
})

describe("causes with an exact fix", () => {
  it("recognises npm refusing a package over the Node floor", () => {
    const d = read(["npm ERR! code EBADENGINE", "npm ERR! notsup Unsupported engine"])!
    expect(d.cause).toBe("nodeTooOld")
    expect(d.title).toBe(f.nodeTooOldTitle)
    expect(d.destination).toBe("environment")
    expect(d.actionLabel).toBe(f.openSection(en.menu.environment))
    expect(d.evidence).toBe("npm ERR! code EBADENGINE")
  })

  it("recognises a full disk, and points at the section that reclaims space", () => {
    const d = read(["ENOSPC: no space left on device, write"])!
    expect(d.cause).toBe("diskFull")
    expect(d.destination).toBe("cleanup")
  })

  it("recognises the Windows wording for a full disk too", () => {
    expect(read(["There is not enough space on the disk."])?.cause).toBe("diskFull")
  })
})

describe("causes the retry ladder already reasons about", () => {
  it("agrees with the classifier the runner gates its retries on", () => {
    // One implementation of "what kind of failure is this", so an explanation
    // and an automatic retry can never disagree about it.
    expect(read(["npm ERR! network request to https://registry.npmjs.org failed"])?.cause).toBe(
      "network"
    )
    expect(read(["Error: EACCES: permission denied, mkdir '/usr/local/lib'"])?.cause).toBe(
      "permission"
    )
    expect(read(["command not found: winget"])?.cause).toBe("notFound")
  })

  it("quotes the line the verdict came from", () => {
    const d = read(["npm WARN something", "  curl: (28) Operation timed out  "])!
    expect(d.cause).toBe("network")
    expect(d.evidence).toBe("curl: (28) Operation timed out")
  })

  it("sends each of them somewhere that can actually help", () => {
    expect(read(["ETIMEDOUT"])?.destination).toBe("network")
    // Some tools publish a user-scope method that needs no elevation, and the
    // CLIs section is where that is chosen.
    expect(read(["Access is denied."])?.destination).toBe("clis")
    expect(read(["no such file or directory"])?.destination).toBe("environment")
  })

  it("lets an exact code outrank a broader match in the same output", () => {
    // npm prints EBADENGINE alongside plenty of noise; reading it as a
    // permission problem would send the user to change an install method that
    // was never the issue.
    const d = read(["npm ERR! code EBADENGINE", "npm ERR! operation not permitted"])!
    expect(d.cause).toBe("nodeTooOld")
  })
})

describe("a failure nothing matched", () => {
  const d = () => read(["Building…", "internal assertion 42", ""])!

  it("says it could not read the failure rather than guessing", () => {
    // A confident wrong reading sends someone to fix a page that was never
    // broken, and costs them the one thing they had.
    expect(d().cause).toBe("unknown")
    expect(d().title).toBe(f.unknownTitle)
  })

  it("offers no destination, because there is no page that helps", () => {
    expect(d().destination).toBeUndefined()
    expect(d().actionLabel).toBeUndefined()
  })

  it("quotes the last line with anything on it, not the first", () => {
    // Tools print their banner and their progress before they print what went
    // wrong, so the top of the output is almost never the interesting part.
    expect(d().evidence).toBe("internal assertion 42")
  })

  it("quotes nothing when the step said nothing at all", () => {
    expect(read([])?.evidence).toBeUndefined()
    expect(read(["   ", ""])?.evidence).toBeUndefined()
  })
})

describe("grouping", () => {
  const network = (id: string) => failed({ id, label: id, output: ["ETIMEDOUT"] })

  it("gives one reading per cause, however many steps share it", () => {
    // Five steps that died on the same blocked download are one problem with
    // one fix, and the fix stops being read around the third copy of it.
    const groups = groupFailures(en, [network("a"), network("b"), network("c")])
    expect(groups).toHaveLength(1)
    expect(groups[0].steps.map((s) => s.id)).toEqual(["a", "b", "c"])
  })

  it("keeps two different causes apart", () => {
    const groups = groupFailures(en, [
      network("a"),
      failed({ id: "b", label: "b", output: ["ENOSPC"] }),
    ])
    expect(groups.map((g) => g.diagnosis.cause)).toEqual(["network", "diskFull"])
  })

  it("keeps the first member's quote, which is the one the reading was written from", () => {
    const groups = groupFailures(en, [
      failed({ id: "a", label: "a", output: ["ECONNRESET"] }),
      failed({ id: "b", label: "b", output: ["ETIMEDOUT"] }),
    ])
    expect(groups[0].diagnosis.evidence).toBe("ECONNRESET")
  })

  it("ignores everything that isn't a failure", () => {
    expect(groupFailures(en, [{ ...failed(), status: "done" }])).toEqual([])
    expect(groupFailures(en, [])).toEqual([])
  })

  it("orders causes by when they first failed", () => {
    const groups = groupFailures(en, [
      failed({ id: "a", label: "a", output: ["ENOSPC"] }),
      network("b"),
    ])
    expect(groups.map((g) => g.diagnosis.cause)).toEqual(["diskFull", "network"])
  })
})

it("is fully translated", () => {
  const reports = [
    failed({ id: "a", label: "a", output: ["EBADENGINE"] }),
    failed({ id: "b", label: "b", output: ["ETIMEDOUT"] }),
    failed({ id: "c", label: "c", output: ["something unreadable"] }),
  ]
  const zh = groupFailures(zhCN, reports)
  const eng = groupFailures(en, reports)
  expect(zh.map((g) => g.diagnosis.cause)).toEqual(eng.map((g) => g.diagnosis.cause))
  for (let i = 0; i < zh.length; i++) {
    expect(zh[i].diagnosis.title).not.toBe(eng[i].diagnosis.title)
    expect(zh[i].diagnosis.advice.trim()).not.toBe("")
    // The quote is the machine's own words, so it must NOT be translated.
    expect(zh[i].diagnosis.evidence).toBe(eng[i].diagnosis.evidence)
  }
})
