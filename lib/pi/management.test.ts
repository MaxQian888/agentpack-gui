import {
  buildPiPackageSteps,
  buildPiResourceToggleStep,
  clearedResourceFilters,
  buildPiResourcePathToggleStep,
  piSettingsHash,
  piResourcePathEnabled,
  isPiExactResourcePath,
  isSafePiPackageSource,
  piResourcesOnCount,
  piResourcesOnFor,
  redactPiPackageSource,
  setPackageResourceEnabled,
  setPackageResourcePathEnabled,
} from "./management"
import type { Paths } from "@/lib/agentpack/types"
import type { PiPackageRecord } from "./types"

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

describe("package source edge cases", () => {
  it("redacts userinfo from a URL that has no path after the host", () => {
    expect(redactPiPackageSource("https://token@host.example")).toBe("https://***@host.example")
    expect(redactPiPackageSource("https://host.example")).toBe("https://host.example")
  })

  it("redacts a git: shorthand whose authority has no path at all", () => {
    expect(redactPiPackageSource("git:secret@host")).toBe("git:***@host")
    expect(redactPiPackageSource("git:host/acme/repo")).toBe("git:host/acme/repo")
  })

  it("accepts the conventional git@ user on scheme, scp and git: forms", () => {
    for (const source of [
      "ssh://git@github.com/acme/repo",
      "git:ssh://git@github.com/acme/repo",
      "git@github.com:acme/repo",
      "git:git@github.com/acme/repo",
      "git:github.com/acme/repo",
      "npm:@scope/pi-demo",
    ]) {
      expect(isSafePiPackageSource(source)).toBe(true)
    }
  })

  it("refuses any userinfo over http(s), even the git user", () => {
    expect(isSafePiPackageSource("https://git@github.com/acme/repo")).toBe(false)
    expect(isSafePiPackageSource("http://git@host")).toBe(false)
  })

  it("refuses credentials in a git: shorthand with no path", () => {
    expect(isSafePiPackageSource("git:token@host")).toBe(false)
    expect(isSafePiPackageSource("git:git@host")).toBe(true)
  })

  it("refuses a fragment as well as a query", () => {
    expect(isSafePiPackageSource("npm:pi-demo#token")).toBe(false)
    expect(redactPiPackageSource("npm:pi-demo#token")).toBe("npm:pi-demo#***")
  })

  it("passes the project cwd only to project-scoped commands", () => {
    const [update] = buildPiPackageSteps(
      { kind: "updateAll" },
      { kind: "project", cwd: "/work/repo", approved: true },
      paths,
      copy
    )
    expect(update).toMatchObject({
      id: "pi-package-update-all",
      label: "updateAll all",
      command: { args: ["update", "--extensions", "--approve"], cwd: "/work/repo" },
    })
    const [global] = buildPiPackageSteps({ kind: "updateAll" }, { kind: "global" }, paths, copy)
    if (global.kind !== "command") throw new Error("expected command step")
    expect(global.command).not.toHaveProperty("cwd")
  })

  it("labels and ids a step by the redacted source, never the raw one", () => {
    const [step] = buildPiPackageSteps(
      { kind: "update", source: "git:git@github.com:acme/repo" },
      { kind: "project", cwd: "/w", approved: true },
      paths,
      copy
    )
    // Redaction is deliberately blunt: even the conventional `git@` user is masked
    // in what is displayed and hashed, while the argv keeps the real source.
    expect(step.label).toBe("update git:***@github.com:acme/repo")
    expect(step.id).toBe(`pi-package-update-${piSettingsHash("git:***@github.com:acme/repo")}`)
    expect(step).toMatchObject({
      command: { args: ["update", "--extension", "git:git@github.com:acme/repo", "--approve"] },
    })
  })
})

describe("piResourcePathEnabled / piResourcesOnFor", () => {
  it("lets an exact -path override switch one file off under a matching glob", () => {
    expect(piResourcePathEnabled("skills/a.md", ["skills/*.md", "-skills/a.md"])).toBe(false)
    expect(piResourcePathEnabled("skills/b.md", ["skills/*.md", "-skills/a.md"])).toBe(true)
  })

  it("treats a list of only overrides as 'everything, minus/plus these'", () => {
    expect(piResourcePathEnabled("skills/a.md", ["-skills/b.md"])).toBe(true)
    expect(piResourcePathEnabled("skills/b.md", ["-skills/b.md"])).toBe(false)
  })

  it("matches ** across directories but * only within one", () => {
    expect(piResourcePathEnabled("skills/x/y/SKILL.md", ["skills/**"])).toBe(true)
    expect(piResourcePathEnabled("skills/x/y/SKILL.md", ["skills/*"])).toBe(false)
    expect(piResourcePathEnabled("skills/a.md", ["skills/?.md"])).toBe(true)
  })

  it("counts off, on-in-full and narrowed as three different answers", () => {
    const declared = ["a.md", "b.md", "c.md"]
    expect(piResourcesOnFor(undefined)).toBe(0)
    expect(piResourcesOnFor({ enabled: false, configured: true, filters: [], declared })).toBe(0)
    expect(piResourcesOnFor({ enabled: true, configured: false, filters: [], declared })).toBe(3)
    expect(
      piResourcesOnFor({ enabled: true, configured: true, filters: ["-b.md"], declared })
    ).toBe(2)
  })

  it("sums the loaded files across a package's kinds", () => {
    const state = (declared: string[], filters: string[] = []) => ({
      enabled: true,
      configured: filters.length > 0,
      filters,
      declared,
    })
    const pkg = {
      resources: {
        extensions: state(["e.js"]),
        skills: state(["a.md", "b.md"], ["-a.md"]),
        prompts: { enabled: false, configured: true, filters: [], declared: ["p.md"] },
        themes: state([]),
      },
    } as unknown as PiPackageRecord
    expect(piResourcesOnCount(pkg)).toBe(2)
  })

  it("never treats an empty string as an exact path", () => {
    expect(isPiExactResourcePath("")).toBe(false)
    expect(isPiExactResourcePath("+skills/a.md")).toBe(false)
    expect(isPiExactResourcePath("skills/{a,b}.md")).toBe(false)
  })
})

describe("settings merges on unusual input", () => {
  it("refuses a settings file that parses to something other than an object", () => {
    for (const text of ["[]", "null", '"text"', "42"]) {
      expect(() => setPackageResourceEnabled(text, "npm:pi-demo", "skills", false)).toThrow(
        "PI_SETTINGS_EXPECTED_OBJECT"
      )
      expect(() =>
        setPackageResourcePathEnabled(text, "npm:pi-demo", "skills", "skills/a.md", false)
      ).toThrow("PI_SETTINGS_EXPECTED_OBJECT")
    }
  })

  it("appends a missing package rather than editing an unrelated or malformed entry", () => {
    const existing = JSON.stringify({
      packages: [null, 7, ["npm:pi-demo"], { name: "no source" }, { source: "npm:other" }],
    })
    const next = JSON.parse(setPackageResourceEnabled(existing, "npm:pi-demo", "themes", false))
    expect(next.packages.slice(0, 5)).toEqual(JSON.parse(existing).packages)
    expect(next.packages[5]).toEqual({ source: "npm:pi-demo", themes: [] })
  })

  it("starts a packages list when the settings have a non-array one", () => {
    const next = JSON.parse(
      setPackageResourceEnabled('{"packages":"oops","theme":"x"}', "npm:pi-demo", "skills", true)
    )
    expect(next).toEqual({ packages: [{ source: "npm:pi-demo" }], theme: "x" })
  })

  it("writes +path for an enabling delta and refuses a delta with no exact path", () => {
    const next = JSON.parse(
      setPackageResourceEnabled("{}", "npm:pi-demo", "skills", true, true, ["skills/a.md"])
    )
    expect(next.packages[0]).toEqual({
      source: "npm:pi-demo",
      autoload: false,
      skills: ["+skills/a.md"],
    })
    expect(() =>
      setPackageResourceEnabled("{}", "npm:pi-demo", "skills", true, true, ["skills/*.md"])
    ).toThrow("PI_DELTA_RESOURCE_PATH_REQUIRED")
    expect(() => setPackageResourceEnabled("{}", "npm:pi-demo", "skills", true, true)).toThrow(
      "PI_DELTA_RESOURCE_PATH_REQUIRED"
    )
  })

  it("replaces an exact override in place and keeps every other filter", () => {
    const existing = JSON.stringify({
      packages: [
        { source: "npm:pi-demo", themes: ["themes/*.json", "-themes/dark.json", 3, "+themes/x"] },
      ],
    })
    const next = JSON.parse(
      setPackageResourcePathEnabled(existing, "npm:pi-demo", "themes", "themes/dark.json", true)
    )
    expect(next.packages[0].themes).toEqual(["themes/*.json", "+themes/x", "+themes/dark.json"])
  })

  it("creates a project delta entry for an inherited package on a path toggle", () => {
    const next = JSON.parse(
      setPackageResourcePathEnabled("", "npm:pi-demo", "skills", "skills/a.md", false, true)
    )
    expect(next.packages).toEqual([
      { source: "npm:pi-demo", autoload: false, skills: ["-skills/a.md"] },
    ])
    const global = JSON.parse(
      setPackageResourcePathEnabled("{}", "npm:pi-demo", "skills", "skills/a.md", true)
    )
    expect(global.packages).toEqual([{ source: "npm:pi-demo", skills: ["+skills/a.md"] }])
  })

  it("counts only the filters a delta does not re-add", () => {
    const settings = JSON.stringify({
      packages: [{ source: "npm:pi-demo", skills: ["-skills/a.md", "-skills/b.md", 9] }],
    })
    expect(
      clearedResourceFilters(settings, "npm:pi-demo", "skills", false, true, ["skills/a.md"])
    ).toBe(1)
    expect(
      clearedResourceFilters(settings, "npm:pi-demo", "skills", true, true, ["skills/a.md"])
    ).toBe(2)
    expect(clearedResourceFilters("[]", "npm:pi-demo", "skills", false)).toBe(0)
  })
})

describe("merge steps translate their failures", () => {
  const bare = { ...copy, errors: {} as Record<string, string> }

  it("maps a merge error code through the copy, or surfaces the code itself", () => {
    const step = buildPiResourceToggleStep(
      "/p/.pi/settings.json",
      "[]",
      "npm:pi-demo",
      "skills",
      false,
      copy
    )
    if (step.kind !== "mergeFile") throw new Error("expected merge step")
    expect(() => step.merge("[]")).toThrow("Invalid Pi settings JSON")

    const unmapped = buildPiResourceToggleStep(
      "/p/.pi/settings.json",
      "{}",
      "npm:pi-demo",
      "skills",
      false,
      bare,
      true,
      []
    )
    if (unmapped.kind !== "mergeFile") throw new Error("expected merge step")
    expect(() => unmapped.merge("{}")).toThrow("PI_DELTA_RESOURCE_PATH_REQUIRED")
  })

  it("rejects a path toggle when the file changed after review", () => {
    const reviewed = '{"packages":[]}'
    const step = buildPiResourcePathToggleStep(
      "/p/.pi/settings.json",
      reviewed,
      "npm:pi-demo",
      "skills",
      "skills/a.md",
      true,
      copy
    )
    if (step.kind !== "mergeFile") throw new Error("expected merge step")
    expect(() => step.merge('{"packages":[],"theme":"x"}')).toThrow("settings changed")
    expect(step.id).toBe("pi-package-resource-skills-npm:pi-demo-skills/a.md")
  })

  it("surfaces an unmapped path-toggle error code verbatim", () => {
    const step = buildPiResourcePathToggleStep(
      "/p/.pi/settings.json",
      "{}",
      "npm:pi-demo",
      "skills",
      "skills/*.md",
      true,
      bare
    )
    if (step.kind !== "mergeFile") throw new Error("expected merge step")
    expect(() => step.merge("{}")).toThrow("PI_RESOURCE_EXACT_PATH_REQUIRED")
  })
})
