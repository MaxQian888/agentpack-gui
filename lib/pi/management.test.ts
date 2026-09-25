import {
  buildPiPackageSteps,
  buildPiResourceToggleStep,
  clearedResourceFilters,
  buildPiResourcePathToggleStep,
  piSettingsHash,
  piResourcePathEnabled,
  isPiExactResourcePath,
  redactPiPackageSource,
  setPackageResourceEnabled,
} from "./management"
import type { Paths } from "@/lib/agentpack/types"

const paths = {
  piSettings: "/home/me/.pi/agent/settings.json",
} as Paths
const copy = {
  packageAction: (action: string, source: string) => `${action} ${source}`,
  resourceAction: (enabled: boolean, kind: string, source: string) =>
    `${enabled ? "enable" : "disable"} ${kind} ${source}`,
  errors: {
    PI_PACKAGE_SOURCE_UNSAFE: "unsafe package source",
    PI_PROJECT_APPROVAL_REQUIRED: "Project approval is required",
    PI_SETTINGS_INVALID_JSON: "Invalid Pi settings JSON",
    PI_SETTINGS_EXPECTED_OBJECT: "Invalid Pi settings JSON",
    PI_DELTA_RESOURCE_PATH_REQUIRED: "installed resource path required",
    PI_RESOURCE_EXACT_PATH_REQUIRED: "exact path required",
    PI_SETTINGS_CHANGED: "settings changed",
  },
}

describe("buildPiPackageSteps", () => {
  it("builds global and trusted project package commands without a shell", () => {
    const global = buildPiPackageSteps(
      { kind: "install", source: "npm:pi-demo" },
      { kind: "global" },
      paths,
      copy
    )
    expect(global[0]).toMatchObject({
      kind: "command",
      command: { file: "pi", args: ["install", "npm:pi-demo"] },
    })

    const project = buildPiPackageSteps(
      { kind: "remove", source: "git:github.com/acme/pi-demo" },
      { kind: "project", cwd: "/work/repo", approved: true },
      paths,
      copy
    )
    expect(project[0]).toMatchObject({
      kind: "command",
      command: {
        file: "pi",
        args: ["remove", "git:github.com/acme/pi-demo", "-l", "--approve"],
        cwd: "/work/repo",
      },
    })
  })

  it("refuses project mutations until the caller records explicit approval", () => {
    expect(() =>
      buildPiPackageSteps(
        { kind: "install", source: "npm:pi-demo" },
        { kind: "project", cwd: "/work/repo", approved: false },
        paths,
        copy
      )
    ).toThrow("Project approval is required")
  })

  it("updates packages explicitly instead of invoking Pi's self-update default", () => {
    const one = buildPiPackageSteps(
      { kind: "update", source: "npm:pi-demo" },
      { kind: "global" },
      paths,
      copy
    )
    expect(one[0]).toMatchObject({
      command: { file: "pi", args: ["update", "--extension", "npm:pi-demo"] },
    })
    const all = buildPiPackageSteps({ kind: "updateAll" }, { kind: "global" }, paths, copy)
    expect(all[0]).toMatchObject({
      command: { file: "pi", args: ["update", "--extensions"] },
    })
  })

  it("never places embedded URL credentials in step metadata or command logs", () => {
    expect(redactPiPackageSource("https://secret@host/repo?token=value")).toBe(
      "https://***@host/repo?***"
    )
    expect(() =>
      buildPiPackageSteps(
        { kind: "install", source: "https://sk-secret@host/repo" },
        { kind: "global" },
        paths,
        copy
      )
    ).toThrow(/unsafe package source/i)
    expect(() =>
      buildPiPackageSteps(
        { kind: "install", source: "https://host/repo?access_token=secret" },
        { kind: "global" },
        paths,
        copy
      )
    ).toThrow(/unsafe package source/i)
    expect(() =>
      buildPiPackageSteps(
        { kind: "install", source: "git:ssh://access-token@host/repo" },
        { kind: "global" },
        paths,
        copy
      )
    ).toThrow(/unsafe package source/i)
    expect(() =>
      buildPiPackageSteps(
        { kind: "install", source: "git:access-token@host:repo" },
        { kind: "global" },
        paths,
        copy
      )
    ).toThrow(/unsafe package source/i)
    for (const source of [
      "git:ssh://git@sk-secret@host/repo",
      "git:git@sk-secret@host:repo",
      "git:git@sk-secret@host/repo",
    ]) {
      expect(() =>
        buildPiPackageSteps({ kind: "install", source }, { kind: "global" }, paths, copy)
      ).toThrow(/unsafe package source/i)
      expect(redactPiPackageSource(source)).not.toContain("sk-secret")
    }
    expect(
      buildPiPackageSteps(
        { kind: "install", source: "git:git@github.com:acme/repo" },
        { kind: "global" },
        paths,
        copy
      )[0]
    ).toMatchObject({ command: { args: ["install", "git:git@github.com:acme/repo"] } })
    expect(redactPiPackageSource("git:ssh://secret@host/repo")).toBe("git:ssh://***@host/repo")
    expect(redactPiPackageSource("git:secret@host:repo")).toBe("git:***@host:repo")
  })
})

describe("setPackageResourceEnabled", () => {
  it("evaluates Pi resource globs and exact force overrides", () => {
    expect(piResourcePathEnabled("themes/dark.json", ["themes/*.json"])).toBe(true)
    expect(
      piResourcePathEnabled("themes/legacy.json", ["themes/*.json", "!themes/legacy.json"])
    ).toBe(false)
    expect(
      piResourcePathEnabled("themes/legacy.json", [
        "themes/*.json",
        "!themes/legacy.json",
        "+themes/legacy.json",
      ])
    ).toBe(true)
    expect(piResourcePathEnabled("themes/dark.json", [])).toBe(false)
    expect(isPiExactResourcePath("themes/dark.json")).toBe(true)
    expect(isPiExactResourcePath("themes/*.json")).toBe(false)
    expect(isPiExactResourcePath("!themes/legacy.json")).toBe(false)
  })

  it("converts a string package to object form and preserves unknown settings", () => {
    const next = setPackageResourceEnabled(
      JSON.stringify({ theme: "dark", packages: ["npm:pi-demo"] }),
      "npm:pi-demo",
      "skills",
      false
    )
    expect(JSON.parse(next)).toEqual({
      theme: "dark",
      packages: [{ source: "npm:pi-demo", skills: [] }],
    })
  })

  it("removes only the selected resource filter when enabling all", () => {
    const next = setPackageResourceEnabled(
      JSON.stringify({
        packages: [{ source: "npm:pi-demo", skills: [], themes: ["themes/*.json"] }],
      }),
      "npm:pi-demo",
      "skills",
      true
    )
    expect(JSON.parse(next).packages[0]).toEqual({
      source: "npm:pi-demo",
      themes: ["themes/*.json"],
    })
  })

  it("rejects malformed settings instead of replacing them", () => {
    expect(() => setPackageResourceEnabled("{broken", "npm:pi-demo", "skills", false)).toThrow(
      "PI_SETTINGS_INVALID_JSON"
    )
  })

  it("rejects a resource write when settings changed after review", () => {
    const reviewed = '{"packages":["npm:pi-demo"]}'
    const step = buildPiResourceToggleStep(
      "/home/me/.pi/agent/settings.json",
      reviewed,
      "npm:pi-demo",
      "skills",
      false,
      copy
    )
    expect(step.kind).toBe("mergeFile")
    if (step.kind !== "mergeFile") return
    expect(() => step.merge('{"packages":["npm:other"]}')).toThrow(/changed/i)
    expect(step.merge(reviewed)).toContain('"skills": []')
    expect(piSettingsHash(reviewed)).toBe(piSettingsHash(reviewed))
  })

  it("stages one declared path with Pi's documented plus/minus filter", () => {
    const reviewed = '{"packages":[{"source":"npm:pi-demo"}]}'
    const step = buildPiResourcePathToggleStep(
      "/home/me/.pi/agent/settings.json",
      reviewed,
      "npm:pi-demo",
      "themes",
      "themes/dark.json",
      false,
      copy
    )
    if (step.kind !== "mergeFile") throw new Error("expected merge step")
    expect(JSON.parse(step.merge(reviewed)).packages[0].themes).toEqual(["-themes/dark.json"])
  })

  it("does not turn declared globs into invalid exact overrides", () => {
    const reviewed = '{"packages":[{"source":"npm:pi-demo"}]}'
    const step = buildPiResourcePathToggleStep(
      "/home/me/.pi/agent/settings.json",
      reviewed,
      "npm:pi-demo",
      "themes",
      "themes/*.json",
      false,
      copy
    )
    if (step.kind !== "mergeFile") throw new Error("expected merge step")
    expect(() => step.merge(reviewed)).toThrow(/exact path/i)
  })

  it("creates project resource overrides as deltas over inherited packages", () => {
    const next = setPackageResourceEnabled("{}", "npm:pi-demo", "skills", false, true, [
      "skills/search/SKILL.md",
      "skills/review.md",
    ])
    expect(JSON.parse(next).packages[0]).toEqual({
      source: "npm:pi-demo",
      autoload: false,
      skills: ["-skills/search/SKILL.md", "-skills/review.md"],
    })
  })

  it("creates a missing settings file from the empty reviewed content", () => {
    const step = buildPiResourceToggleStep(
      "/project/.pi/settings.json",
      "",
      "npm:pi-demo",
      "skills",
      false,
      copy,
      true,
      ["skills/search/SKILL.md"]
    )
    if (step.kind !== "mergeFile") throw new Error("expected merge step")
    expect(JSON.parse(step.merge("")).packages[0]).toEqual({
      source: "npm:pi-demo",
      autoload: false,
      skills: ["-skills/search/SKILL.md"],
    })
  })
})

describe("clearedResourceFilters", () => {
  const settings = JSON.stringify({
    packages: [{ source: "npm:pi-demo", skills: ["skills/a/**", "-skills/a/old.md"] }],
  })

  it("counts the file filters a whole-kind toggle drops", () => {
    // On deletes the array and off empties it, so either way both entries go.
    expect(clearedResourceFilters(settings, "npm:pi-demo", "skills", true)).toBe(2)
    expect(clearedResourceFilters(settings, "npm:pi-demo", "skills", false)).toBe(2)
    expect(clearedResourceFilters(settings, "npm:pi-demo", "themes", false)).toBe(0)
    expect(clearedResourceFilters(settings, "npm:other", "skills", false)).toBe(0)
    expect(clearedResourceFilters("{ not json", "npm:pi-demo", "skills", false)).toBe(0)
  })

  it("names the loss in the step label instead of dropping them unannounced", () => {
    const labelled = {
      ...copy,
      resourceAction: (enabled: boolean, kind: string, source: string, cleared = 0) =>
        `${enabled ? "enable" : "disable"} ${kind} ${source}${cleared ? ` (clears ${cleared})` : ""}`,
    }
    const step = buildPiResourceToggleStep(
      "/home/me/.pi/agent/settings.json",
      settings,
      "npm:pi-demo",
      "skills",
      false,
      labelled
    )
    expect(step.label).toBe("disable skills npm:pi-demo (clears 2)")
    if (step.kind !== "mergeFile") throw new Error("expected merge step")
    expect(step.writtenNote).toBe(step.label)
  })
})
