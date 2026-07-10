"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Download, FolderOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { saveSettings } from "@/lib/tauri/settings"
import { pickFolder } from "@/lib/tauri/dialog"
import { cleanupRepoScan, fetchRepoSkills, pathExists } from "@/lib/tauri/commands"
import { skillCopyStep, skillRepoInstallStep } from "@/lib/agentpack/plan"
import { filterBySubpath, parseRepoSource, tarballUrl } from "@/lib/skills/github"
import { npxSkillsAddCommand } from "@/lib/skills/npx"
import { skillDescription, skillName, splitFrontmatter } from "@/lib/skills/frontmatter"
import { SKILL_SOURCES } from "@/lib/skills/browse"
import type { Paths } from "@/lib/agentpack/types"
import type { RepoScan, SkillSource } from "@/lib/skills/types"
import { useRunnerCtx } from "../../run/runner-context"

function skillsDirFor(paths: Paths, source: SkillSource): string {
  switch (source) {
    case "claude":
      return paths.claudeSkillsDir
    case "codex":
      return paths.codexSkillsDir
    case "opencode":
      return paths.opencodeSkillsDir
    case "agents":
      return paths.agentsSkillsDir
  }
}

/** Shared "Install into" target checkboxes. */
function TargetPicker({
  targets,
  onToggle,
}: {
  targets: Set<SkillSource>
  onToggle: (t: SkillSource) => void
}) {
  const sb = useT().skillsBrowser
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <span className="text-muted-foreground">{sb.selectTargets}</span>
      {SKILL_SOURCES.map((target) => (
        <label key={target} className="flex cursor-pointer items-center gap-2">
          <Checkbox checked={targets.has(target)} onCheckedChange={() => onToggle(target)} />
          {sb.sources[target]}
        </label>
      ))}
    </div>
  )
}

function toggleIn(set: Set<SkillSource>, t: SkillSource): Set<SkillSource> {
  const next = new Set(set)
  if (next.has(t)) next.delete(t)
  else next.add(t)
  return next
}

export function AddSkillsTab({ refresh }: { refresh: () => void }) {
  const t = useT()
  const sb = t.skillsBrowser
  const paths = useAppStore((s) => s.paths)
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const { run } = useRunnerCtx()

  // ----- GitHub direct install -----
  const [source, setSource] = useState("")
  const [fetching, setFetching] = useState(false)
  const [fetchErr, setFetchErr] = useState<string | null>(null)
  const [scan, setScan] = useState<RepoScan | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [ghTargets, setGhTargets] = useState<Set<SkillSource>>(new Set(["claude", "codex"]))

  // Any not-yet-installed scan dir is deleted on unmount (best-effort; the Rust
  // side also sweeps scans older than 24h).
  const scanIdRef = useRef<string | null>(null)
  useEffect(() => {
    scanIdRef.current = scan?.scanId ?? null
  }, [scan])
  useEffect(
    () => () => {
      if (scanIdRef.current) void cleanupRepoScan(scanIdRef.current).catch(() => {})
    },
    []
  )

  const repoSkillMeta = useMemo(
    () =>
      (scan?.skills ?? []).map((s) => {
        const doc = splitFrontmatter(s.skillMd)
        return { ...s, name: skillName(doc, s.dirName), description: skillDescription(doc) }
      }),
    [scan]
  )

  const fetchNow = async () => {
    const ref = parseRepoSource(source)
    if (!ref) {
      setFetchErr(sb.invalidSource)
      return
    }
    if (scan) void cleanupRepoScan(scan.scanId).catch(() => {})
    setScan(null)
    setFetching(true)
    setFetchErr(null)
    try {
      const result = await fetchRepoSkills(tarballUrl(ref, settings.ghMirrorPrefix))
      const skills = filterBySubpath(result.skills, ref.subpath)
      if (skills.length === 0) {
        setFetchErr(sb.noSkillsInRepo)
        void cleanupRepoScan(result.scanId).catch(() => {})
      } else {
        setScan({ scanId: result.scanId, skills })
        setPicked(new Set(skills.map((s) => s.relPath)))
      }
    } catch (e) {
      setFetchErr(sb.fetchError(String(e)))
    } finally {
      setFetching(false)
    }
  }

  const installPicked = async () => {
    if (!scan || !paths || ghTargets.size === 0) return
    const selected = scan.skills.filter((s) => picked.has(s.relPath))
    if (selected.length === 0) return
    const targets = [...ghTargets]
    const dests = selected.flatMap((s) =>
      targets.map((target) => `${skillsDirFor(paths, target)}/${s.dirName}`)
    )
    await run([
      skillRepoInstallStep(
        scan.scanId,
        selected.map(({ relPath, dirName }) => ({ relPath, dirName })),
        targets,
        dests,
        t
      ),
    ])
    void cleanupRepoScan(scan.scanId).catch(() => {})
    setScan(null)
    refresh()
  }

  const runNpx = async () => {
    const src = source.trim()
    if (!src) {
      setFetchErr(sb.invalidSource)
      return
    }
    await run([
      {
        kind: "command",
        id: `npx-skills-add-${Date.now()}`,
        label: sb.useNpx,
        command: npxSkillsAddCommand(src, [...ghTargets]),
      },
    ])
    refresh()
  }

  // ----- Local folder import -----
  const [folder, setFolder] = useState<string | null>(null)
  const [folderErr, setFolderErr] = useState<string | null>(null)
  const [localTargets, setLocalTargets] = useState<Set<SkillSource>>(new Set(["claude", "codex"]))

  const chooseFolder = async () => {
    const selected = await pickFolder()
    if (!selected) return
    const isSkill = await pathExists(`${selected}/SKILL.md`)
    if (!isSkill) {
      setFolder(null)
      setFolderErr(sb.notASkillFolder)
      return
    }
    setFolder(selected)
    setFolderErr(null)
  }

  const importFolder = async () => {
    if (!folder || !paths || localTargets.size === 0) return
    const dirName = folder.split(/[\\/]/).filter(Boolean).pop() ?? ""
    const targets = [...localTargets]
    const dests = targets.map((target) => `${skillsDirFor(paths, target)}/${dirName}`)
    await run([skillCopyStep(dirName, dirName, folder, targets, dests, t)])
    setFolder(null)
    refresh()
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-3 p-4">
        <div>
          <p className="flex items-center gap-2 font-medium">
            <Download className="size-4" /> {sb.addGithubTitle}
          </p>
          <p className="text-sm text-muted-foreground">{sb.addGithubHint}</p>
        </div>
        <div className="flex gap-2">
          <Input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder={sb.sourcePlaceholder}
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") void fetchNow()
            }}
          />
          <Button variant="outline" onClick={() => void fetchNow()} disabled={fetching}>
            {fetching ? <Spinner className="size-4" /> : null}
            {fetching ? sb.fetching : sb.fetchSkills}
          </Button>
        </div>
        {fetchErr ? <p className="text-sm text-destructive">{fetchErr}</p> : null}
        {scan ? (
          <div className="flex flex-col gap-3">
            <div className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-md border p-2">
              {repoSkillMeta.map((s) => (
                <label
                  key={s.relPath}
                  className="flex cursor-pointer items-start gap-2 rounded p-1.5 text-sm hover:bg-accent/40"
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={picked.has(s.relPath)}
                    onCheckedChange={() => {
                      setPicked((prev) => {
                        const next = new Set(prev)
                        if (next.has(s.relPath)) next.delete(s.relPath)
                        else next.add(s.relPath)
                        return next
                      })
                    }}
                  />
                  <span className="min-w-0">
                    <span className="font-medium">{s.name}</span>
                    {s.description ? (
                      <span className="line-clamp-2 block text-xs text-muted-foreground">
                        {s.description}
                      </span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
            <TargetPicker
              targets={ghTargets}
              onToggle={(x) => setGhTargets(toggleIn(ghTargets, x))}
            />
            <div>
              <Button
                size="sm"
                onClick={() => void installPicked()}
                disabled={picked.size === 0 || ghTargets.size === 0}
              >
                {sb.installSelected(picked.size)}
              </Button>
            </div>
          </div>
        ) : null}
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">{sb.advancedTitle}</summary>
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground" htmlFor="gh-mirror">
                {sb.mirrorLabel}
              </label>
              <Input
                id="gh-mirror"
                value={settings.ghMirrorPrefix ?? ""}
                placeholder="https://gh-proxy.com/"
                onChange={(e) => {
                  const value = e.target.value.trim() || null
                  setSettings({ ghMirrorPrefix: value })
                  void saveSettings({ ghMirrorPrefix: value })
                }}
              />
              <p className="text-xs text-muted-foreground">{sb.mirrorHint}</p>
            </div>
            <div>
              <Button variant="outline" size="sm" onClick={() => void runNpx()}>
                {sb.useNpx}
              </Button>
              <p className="mt-1 text-xs text-muted-foreground">{sb.npxHint}</p>
            </div>
          </div>
        </details>
      </Card>

      <Card className="gap-3 p-4">
        <div>
          <p className="flex items-center gap-2 font-medium">
            <FolderOpen className="size-4" /> {sb.addLocalTitle}
          </p>
          <p className="text-sm text-muted-foreground">{sb.addLocalHint}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void chooseFolder()}>
            {sb.pickFolder}
          </Button>
          {folder ? <code className="text-xs break-all">{folder}</code> : null}
        </div>
        {folderErr ? <p className="text-sm text-destructive">{folderErr}</p> : null}
        {folder ? (
          <div className="flex flex-col gap-3">
            <TargetPicker
              targets={localTargets}
              onToggle={(x) => setLocalTargets(toggleIn(localTargets, x))}
            />
            <div>
              <Button
                size="sm"
                onClick={() => void importFolder()}
                disabled={localTargets.size === 0}
              >
                {sb.importNow}
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  )
}
