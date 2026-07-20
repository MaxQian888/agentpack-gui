"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Download, FilePlus2, FolderOpen, GitBranch, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { saveSettings } from "@/lib/tauri/settings"
import { pickFolder } from "@/lib/tauri/dialog"
import { cleanupRepoScan, fetchRepoSkills, pathExists } from "@/lib/tauri/commands"
import { skillCopyStep, skillCreateStep, skillRepoInstallStep } from "@/lib/agentpack/plan"
import { filterBySubpath, parseRepoSource, tarballUrl, type RepoRef } from "@/lib/skills/github"
import { npxSkillsAddCommand } from "@/lib/skills/npx"
import { skillDescription, skillName, splitFrontmatter } from "@/lib/skills/frontmatter"
import { scaffoldSkillMd, type SkillTemplate } from "@/lib/skills/scaffold"
import { SKILL_SOURCES } from "@/lib/skills/browse"
import { skillDestPath } from "@/lib/skills/paths"
import type { RepoScan, RepoSource, SkillsScanResult, SkillSource } from "@/lib/skills/types"
import { useRunnerCtx } from "../../run/runner-context"
import { useInstallGuard } from "./install-conflict-dialog"

/** Curated, verified-to-exist GitHub skill repos offered as one-click sources. */
const RECOMMENDED_SOURCES: RepoSource[] = [
  { url: "anthropics/skills", label: "Anthropic — Agent Skills" },
  { url: "obra/superpowers-skills", label: "Superpowers skills" },
]

/** A skill dir name is the folder + the /command: letters, numbers, dashes. */
const SKILL_NAME_RE = /^[A-Za-z0-9._-]+$/
function isValidSkillName(name: string): boolean {
  return SKILL_NAME_RE.test(name) && name !== "." && name !== ".."
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

export function AddSkillsTab({
  installed,
  refresh,
}: {
  installed: SkillsScanResult | null
  refresh: () => void
}) {
  const t = useT()
  const sb = t.skillsBrowser
  const paths = useAppStore((s) => s.paths)
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const { run } = useRunnerCtx()
  const { guard, dialog: guardDialog } = useInstallGuard()
  const installedSkills = installed?.skills ?? []

  // ----- GitHub direct install -----
  const [source, setSource] = useState("")
  const [fetching, setFetching] = useState(false)
  const [fetchErr, setFetchErr] = useState<string | null>(null)
  const [scan, setScan] = useState<RepoScan | null>(null)
  /** The parsed source of the current scan, recorded as install provenance. */
  const [scanRef, setScanRef] = useState<RepoRef | null>(null)
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

  const fetchNow = async (srcInput: string = source) => {
    const ref = parseRepoSource(srcInput)
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
        setScanRef(ref)
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
    const resolved = await guard(
      selected.map((s) => ({ dirName: s.dirName, targets })),
      installedSkills
    )
    if (!resolved || resolved.length === 0) return
    const targetsByDir = new Map(resolved.map((r) => [r.dirName, r.targets]))
    // One step per skill so each keeps its own (possibly reduced) target set;
    // the id is suffixed with the dir name to stay unique across the shared scanId.
    const steps = selected
      .map((s) => {
        const tg = targetsByDir.get(s.dirName) ?? []
        if (tg.length === 0) return null
        const dests = tg.map((target) => skillDestPath(paths, target, s.dirName))
        const step = skillRepoInstallStep(
          scan.scanId,
          [{ relPath: s.relPath, dirName: s.dirName }],
          tg,
          dests,
          scanRef ? `${scanRef.owner}/${scanRef.repo}` : "",
          scanRef?.ref ?? "HEAD",
          t
        )
        return { ...step, id: `${step.id}-${s.dirName}` }
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
    if (steps.length === 0) return
    await run(steps)
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
    const resolved = await guard([{ dirName, targets: [...localTargets] }], installedSkills)
    if (!resolved || resolved.length === 0) return
    const targets = resolved[0].targets
    const dests = targets.map((target) => skillDestPath(paths, target, dirName))
    await run([skillCopyStep(dirName, dirName, folder, targets, dests, t)])
    setFolder(null)
    refresh()
  }

  // ----- Saved repo sources (marketplace) -----
  const repoSources = settings.skillRepoSources ?? []
  const [newRepoUrl, setNewRepoUrl] = useState("")
  const [newRepoLabel, setNewRepoLabel] = useState("")

  const persistSources = (next: RepoSource[]) => {
    setSettings({ skillRepoSources: next })
    void saveSettings({ skillRepoSources: next })
  }
  const addRepoSource = (src: RepoSource) => {
    const url = src.url.trim()
    if (!url || repoSources.some((r) => r.url === url)) return
    persistSources([...repoSources, { ...src, url }])
  }
  const browseSource = (src: RepoSource) => {
    setSource(src.url)
    void fetchNow(src.url)
  }

  // ----- Create a skill -----
  const [newName, setNewName] = useState("")
  const [newDesc, setNewDesc] = useState("")
  const [template, setTemplate] = useState<SkillTemplate>("blank")
  const [createTargets, setCreateTargets] = useState<Set<SkillSource>>(new Set(["claude", "codex"]))
  const trimmedName = newName.trim()
  const nameValid = trimmedName === "" || isValidSkillName(trimmedName)

  const createSkillNow = async () => {
    if (!paths || createTargets.size === 0 || !isValidSkillName(trimmedName)) return
    const resolved = await guard(
      [{ dirName: trimmedName, targets: [...createTargets] }],
      installedSkills
    )
    if (!resolved || resolved.length === 0) return
    const targets = resolved[0].targets
    // A kept target that already has this skill means the user chose to overwrite.
    const overwrite = targets.some((tg) =>
      installedSkills.some((s) => s.source === tg && s.dirName === trimmedName)
    )
    const content = scaffoldSkillMd({ name: trimmedName, description: newDesc, template })
    const dests = targets.map((target) => skillDestPath(paths, target, trimmedName))
    await run([skillCreateStep(trimmedName, targets, content, dests, t, overwrite)])
    setNewName("")
    setNewDesc("")
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
            <GitBranch className="size-4" /> {sb.reposTitle}
          </p>
          <p className="text-sm text-muted-foreground">{sb.reposHint}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            value={newRepoUrl}
            onChange={(e) => setNewRepoUrl(e.target.value)}
            placeholder={sb.repoUrlPlaceholder}
            className="min-w-40 flex-1"
          />
          <Input
            value={newRepoLabel}
            onChange={(e) => setNewRepoLabel(e.target.value)}
            placeholder={sb.repoLabelPlaceholder}
            className="w-40"
          />
          <Button
            variant="outline"
            onClick={() => {
              addRepoSource({ url: newRepoUrl, label: newRepoLabel.trim() || undefined })
              setNewRepoUrl("")
              setNewRepoLabel("")
            }}
            disabled={!newRepoUrl.trim()}
          >
            {sb.addRepo}
          </Button>
        </div>
        {repoSources.length === 0 ? (
          <p className="text-sm text-muted-foreground">{sb.reposEmpty}</p>
        ) : (
          <div className="flex flex-col gap-1">
            {repoSources.map((r) => (
              <div
                key={r.url}
                className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{r.label ?? r.url}</span>
                  {r.label ? (
                    <span className="ml-2 text-xs text-muted-foreground">{r.url}</span>
                  ) : null}
                </span>
                <Button variant="ghost" size="sm" onClick={() => browseSource(r)}>
                  {sb.browse}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={sb.removeRepo}
                  onClick={() => persistSources(repoSources.filter((x) => x.url !== r.url))}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">{sb.recommendedTitle}:</span>
          {RECOMMENDED_SOURCES.filter((rec) => !repoSources.some((r) => r.url === rec.url)).map(
            (rec) => (
              <button
                key={rec.url}
                type="button"
                onClick={() => addRepoSource(rec)}
                className="rounded-full border px-2.5 py-0.5 hover:bg-accent/40"
              >
                + {rec.label ?? rec.url}
              </button>
            )
          )}
        </div>
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

      <Card className="gap-3 p-4">
        <div>
          <p className="flex items-center gap-2 font-medium">
            <FilePlus2 className="size-4" /> {sb.createTitle}
          </p>
          <p className="text-sm text-muted-foreground">{sb.createHint}</p>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="new-skill-name">
              {sb.nameLabel}
            </label>
            <Input
              id="new-skill-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="my-skill"
              aria-invalid={!nameValid}
            />
            <p className={cn("text-xs", nameValid ? "text-muted-foreground" : "text-destructive")}>
              {nameValid ? sb.nameHint : sb.nameInvalid}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="new-skill-desc">
              {sb.descriptionLabel}
            </label>
            <Textarea
              id="new-skill-desc"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder={sb.descriptionPlaceholder}
              className="min-h-16"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{sb.templateLabel}</span>
              <Select value={template} onValueChange={(v) => setTemplate(v as SkillTemplate)}>
                <SelectTrigger size="sm" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="blank">{sb.templateBlank}</SelectItem>
                  <SelectItem value="reference">{sb.templateReference}</SelectItem>
                  <SelectItem value="task">{sb.templateTask}</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
          <TargetPicker
            targets={createTargets}
            onToggle={(x) => setCreateTargets(toggleIn(createTargets, x))}
          />
          <div>
            <Button
              size="sm"
              onClick={() => void createSkillNow()}
              disabled={!trimmedName || !nameValid || createTargets.size === 0}
            >
              {sb.createNow}
            </Button>
          </div>
        </div>
      </Card>

      {guardDialog}
    </div>
  )
}
