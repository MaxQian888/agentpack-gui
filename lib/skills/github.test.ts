import { filterBySubpath, parseRepoSource, tarballUrl } from "./github"
import type { RepoSkill } from "./types"

describe("parseRepoSource", () => {
  it("parses owner/repo shorthand", () => {
    expect(parseRepoSource("vercel-labs/skills")).toEqual({
      owner: "vercel-labs",
      repo: "skills",
      ref: "HEAD",
      subpath: "",
    })
  })

  it("parses full github.com URLs with and without .git", () => {
    expect(parseRepoSource("https://github.com/vercel-labs/agent-skills")).toMatchObject({
      owner: "vercel-labs",
      repo: "agent-skills",
    })
    expect(parseRepoSource("https://github.com/o/r.git")).toMatchObject({ repo: "r" })
    expect(parseRepoSource("github.com/o/r")).toMatchObject({ owner: "o", repo: "r" })
    expect(parseRepoSource("https://www.github.com/o/r/")).toMatchObject({ owner: "o", repo: "r" })
  })

  it("parses tree/<ref>/<subpath> deep links", () => {
    expect(
      parseRepoSource("https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design")
    ).toEqual({
      owner: "vercel-labs",
      repo: "agent-skills",
      ref: "main",
      subpath: "skills/web-design",
    })
    expect(parseRepoSource("https://github.com/o/r/tree/v1.2.0")).toEqual({
      owner: "o",
      repo: "r",
      ref: "v1.2.0",
      subpath: "",
    })
  })

  it("strips query strings and fragments", () => {
    expect(parseRepoSource("https://github.com/o/r?tab=readme#skills")).toMatchObject({
      owner: "o",
      repo: "r",
    })
  })

  it("rejects garbage", () => {
    expect(parseRepoSource("")).toBeNull()
    expect(parseRepoSource("not a repo")).toBeNull()
    expect(parseRepoSource("a/b/c")).toBeNull()
    expect(parseRepoSource("https://gitlab.com/o/r")).toBeNull()
    expect(parseRepoSource("https://github.com/only-owner")).toBeNull()
    expect(parseRepoSource("owner/re po")).toBeNull()
  })
})

describe("tarballUrl", () => {
  const ref = { owner: "o", repo: "r", ref: "HEAD", subpath: "" }

  it("builds the codeload URL", () => {
    expect(tarballUrl(ref)).toBe("https://codeload.github.com/o/r/tar.gz/HEAD")
  })

  it("prepends a mirror prefix, normalizing the slash", () => {
    expect(tarballUrl(ref, "https://gh-proxy.com/")).toBe(
      "https://gh-proxy.com/https://codeload.github.com/o/r/tar.gz/HEAD"
    )
    expect(tarballUrl(ref, "https://gh-proxy.com")).toBe(
      "https://gh-proxy.com/https://codeload.github.com/o/r/tar.gz/HEAD"
    )
    expect(tarballUrl(ref, "  ")).toBe("https://codeload.github.com/o/r/tar.gz/HEAD")
    expect(tarballUrl(ref, null)).toBe("https://codeload.github.com/o/r/tar.gz/HEAD")
  })
})

describe("filterBySubpath", () => {
  const skills: RepoSkill[] = [
    { dirName: "web-design", relPath: "skills/web-design", skillMd: "" },
    { dirName: "react", relPath: "skills/react", skillMd: "" },
    { dirName: "root", relPath: "", skillMd: "" },
  ]

  it("keeps everything when subpath is empty", () => {
    expect(filterBySubpath(skills, "")).toHaveLength(3)
  })

  it("keeps only skills under the subpath (exact or nested)", () => {
    expect(filterBySubpath(skills, "skills/web-design").map((s) => s.dirName)).toEqual([
      "web-design",
    ])
    expect(filterBySubpath(skills, "skills").map((s) => s.dirName)).toEqual(["web-design", "react"])
    // Prefix must be segment-aligned: "skills/web" matches nothing.
    expect(filterBySubpath(skills, "skills/web")).toEqual([])
  })
})
