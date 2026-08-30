import type { Paths, StepDescriptor } from "@/lib/agentpack/types"
import type { PiResourceKind } from "./types"

export type PiScope = { kind: "global" } | { kind: "project"; cwd: string; approved: boolean }

export type PiPackageAction =
  { kind: "install" | "remove" | "update"; source: string } | { kind: "updateAll" }

export interface PiManagementCopy {
  packageAction: (action: "install" | "remove" | "update" | "updateAll", source: string) => string
  resourceAction: (enabled: boolean, kind: string, source: string) => string
  errors: Record<string, string>
}

/** Small deterministic content fingerprint used to reject stale settings writes. */
export function piSettingsHash(content: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

function commandStep(id: string, label: string, args: string[], scope: PiScope): StepDescriptor {
  return {
    kind: "command",
    id,
    label,
    command: {
      file: "pi",
      args,
      ...(scope.kind === "project" ? { cwd: scope.cwd } : {}),
    },
  }
}

export function redactPiPackageSource(source: string): string {
  const prefix = source.startsWith("git:") ? "git:" : ""
  let value = prefix ? source.slice(prefix.length) : source
  const scheme = value.match(/^([a-z][a-z\d+.-]*:\/\/)/i)
  if (scheme) {
    const authorityStart = scheme[0].length
    const authorityEnd = value.slice(authorityStart).search(/[/?#]/)
    const end = authorityEnd < 0 ? value.length : authorityStart + authorityEnd
    const lastAt = value.slice(authorityStart, end).lastIndexOf("@")
    if (lastAt >= 0) {
      value = `${value.slice(0, authorityStart)}***${value.slice(authorityStart + lastAt)}`
    }
  } else {
    const slash = value.indexOf("/")
    const colon = value.indexOf(":")
    if (colon >= 0 && (slash < 0 || colon < slash)) {
      const lastAt = value.slice(0, colon).lastIndexOf("@")
      if (lastAt >= 0) value = `***${value.slice(lastAt)}`
    } else if (prefix) {
      const authorityEnd = slash < 0 ? value.length : slash
      const lastAt = value.slice(0, authorityEnd).lastIndexOf("@")
      if (lastAt >= 0) value = `***${value.slice(lastAt)}`
    }
  }
  return `${prefix}${value.replace(/([?#]).*$/, "$1***")}`
}

function assertSafePackageSource(source: string, copy: PiManagementCopy): void {
  const normalized = source.replace(/^git:/, "")
  const scheme = normalized.match(/^([a-z][a-z\d+.-]*):\/\//i)
  let unsafeUserInfo = false
  let httpUserInfo = false
  if (scheme) {
    const authorityStart = scheme[0].length
    const authorityEnd = normalized.slice(authorityStart).search(/[/?#]/)
    const authority = normalized.slice(
      authorityStart,
      authorityEnd < 0 ? normalized.length : authorityStart + authorityEnd
    )
    const lastAt = authority.lastIndexOf("@")
    if (lastAt >= 0) {
      const userInfo = authority.slice(0, lastAt)
      unsafeUserInfo = userInfo !== "git" || authority.indexOf("@") !== lastAt
      httpUserInfo = /^https?:\/\//i.test(scheme[0])
    }
  } else {
    const slash = normalized.indexOf("/")
    const colon = normalized.indexOf(":")
    if (colon >= 0 && (slash < 0 || colon < slash)) {
      const authority = normalized.slice(0, colon)
      const lastAt = authority.lastIndexOf("@")
      if (lastAt >= 0) {
        const userInfo = authority.slice(0, lastAt)
        unsafeUserInfo = userInfo !== "git" || authority.indexOf("@") !== lastAt
      }
    } else if (source.startsWith("git:")) {
      const authority = normalized.slice(0, slash < 0 ? normalized.length : slash)
      const lastAt = authority.lastIndexOf("@")
      if (lastAt >= 0) {
        const userInfo = authority.slice(0, lastAt)
        unsafeUserInfo = userInfo !== "git" || authority.indexOf("@") !== lastAt
      }
    }
  }
  if (unsafeUserInfo || httpUserInfo || /[?#]/.test(normalized)) {
    throw new Error(copy.errors.PI_PACKAGE_SOURCE_UNSAFE)
  }
}

/**
 * Build official Pi package commands. No shell string crosses this seam: the
 * runner receives a split argv and, for project scope, an explicit cwd.
 */
export function buildPiPackageSteps(
  action: PiPackageAction,
  scope: PiScope,
  _paths: Paths,
  copy: PiManagementCopy
): StepDescriptor[] {
  void _paths
  if (scope.kind === "project" && !scope.approved) {
    throw new Error(copy.errors.PI_PROJECT_APPROVAL_REQUIRED)
  }
  const projectArgs = scope.kind === "project" ? ["--approve"] : []
  const localArgs = scope.kind === "project" ? ["-l", "--approve"] : []
  if (action.kind !== "updateAll") assertSafePackageSource(action.source, copy)
  const displaySource = action.kind === "updateAll" ? "all" : redactPiPackageSource(action.source)
  const sourceId = piSettingsHash(displaySource)
  switch (action.kind) {
    case "install":
    case "remove":
      return [
        commandStep(
          `pi-package-${action.kind}-${sourceId}`,
          copy.packageAction(action.kind, displaySource),
          [action.kind, action.source, ...localArgs],
          scope
        ),
      ]
    case "update":
      return [
        commandStep(
          `pi-package-update-${sourceId}`,
          copy.packageAction("update", displaySource),
          ["update", "--extension", action.source, ...projectArgs],
          scope
        ),
      ]
    case "updateAll":
      return [
        commandStep(
          "pi-package-update-all",
          copy.packageAction("updateAll", displaySource),
          ["update", "--extensions", ...projectArgs],
          scope
        ),
      ]
  }
}

type PackageObject = { source: string; [key: string]: unknown }

function parseSettings(existing: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = existing.trim() ? JSON.parse(existing) : {}
  } catch {
    throw new Error("PI_SETTINGS_INVALID_JSON")
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("PI_SETTINGS_EXPECTED_OBJECT")
  }
  return parsed as Record<string, unknown>
}

function packageObject(entry: unknown): PackageObject | null {
  if (typeof entry === "string") return { source: entry }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null
  const source = (entry as Record<string, unknown>).source
  return typeof source === "string" ? ({ ...(entry as object), source } as PackageObject) : null
}

function globMatches(path: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  const expression = escaped
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
  return new RegExp(`^${expression.replace(/\u0000/g, ".*")}$`).test(path)
}

/** Evaluate Pi's narrowing globs plus exact +path/-path overrides for one resource. */
export function piResourcePathEnabled(path: string, filters: string[]): boolean {
  if (filters.length === 0) return false
  const selectors = filters.filter((filter) => !/^[!+-]/.test(filter))
  let enabled = selectors.length === 0 || selectors.some((pattern) => globMatches(path, pattern))
  for (const filter of filters) {
    if (filter.startsWith("!") && globMatches(path, filter.slice(1))) enabled = false
    else if (filter === `+${path}`) enabled = true
    else if (filter === `-${path}`) enabled = false
  }
  return enabled
}

/** Only concrete resource paths can use Pi's exact +path/-path override syntax. */
export function isPiExactResourcePath(path: string): boolean {
  return path.length > 0 && !/^[!+-]/.test(path) && !/[?*\[\]{}]/.test(path)
}

/** Preserve every unrelated setting while enabling/disabling one resource type. */
export function setPackageResourceEnabled(
  existing: string,
  source: string,
  kind: PiResourceKind,
  enabled: boolean,
  delta = false,
  resourcePaths: string[] = []
): string {
  const settings = parseSettings(existing)
  const packages = Array.isArray(settings.packages) ? [...settings.packages] : []
  let index = packages.findIndex((entry) => packageObject(entry)?.source === source)
  if (index < 0) {
    packages.push(delta ? { source, autoload: false } : { source })
    index = packages.length - 1
  }
  const entry = packageObject(packages[index])!
  if (delta) {
    const exactPaths = resourcePaths.filter(isPiExactResourcePath)
    if (exactPaths.length === 0) {
      throw new Error("PI_DELTA_RESOURCE_PATH_REQUIRED")
    }
    entry[kind] = exactPaths.map((path) => `${enabled ? "+" : "-"}${path}`)
  } else if (enabled) delete entry[kind]
  else entry[kind] = []
  packages[index] = entry
  return `${JSON.stringify({ ...settings, packages }, null, 2)}\n`
}

/** Enable/disable one exact resource using Pi's documented +path/-path syntax. */
export function setPackageResourcePathEnabled(
  existing: string,
  source: string,
  kind: PiResourceKind,
  path: string,
  enabled: boolean,
  delta = false
): string {
  if (!isPiExactResourcePath(path)) {
    throw new Error("PI_RESOURCE_EXACT_PATH_REQUIRED")
  }
  const settings = parseSettings(existing)
  const packages = Array.isArray(settings.packages) ? [...settings.packages] : []
  let index = packages.findIndex((entry) => packageObject(entry)?.source === source)
  if (index < 0) {
    packages.push(delta ? { source, autoload: false } : { source })
    index = packages.length - 1
  }
  const entry = packageObject(packages[index])!
  const current = Array.isArray(entry[kind])
    ? (entry[kind] as unknown[]).filter((item): item is string => typeof item === "string")
    : []
  const withoutExact = current.filter((item) => item !== `+${path}` && item !== `-${path}`)
  entry[kind] = [...withoutExact, `${enabled ? "+" : "-"}${path}`]
  packages[index] = entry
  return `${JSON.stringify({ ...settings, packages }, null, 2)}\n`
}

/**
 * Stage a settings merge against the exact content shown during review. The
 * runner re-reads immediately before writing; an external edit therefore fails
 * closed instead of being overwritten by a stale package toggle.
 */
export function buildPiResourceToggleStep(
  path: string,
  reviewedContent: string,
  source: string,
  kind: PiResourceKind,
  enabled: boolean,
  copy: PiManagementCopy,
  delta = false,
  resourcePaths: string[] = []
): StepDescriptor {
  const expectedHash = piSettingsHash(reviewedContent)
  return {
    kind: "mergeFile",
    id: `pi-package-resource-${kind}-${source}`,
    label: copy.resourceAction(enabled, kind, source),
    path,
    writtenNote: copy.resourceAction(enabled, kind, source),
    merge: (existing) => {
      if (existing !== reviewedContent || piSettingsHash(existing) !== expectedHash) {
        throw new Error(copy.errors.PI_SETTINGS_CHANGED)
      }
      try {
        return setPackageResourceEnabled(existing, source, kind, enabled, delta, resourcePaths)
      } catch (error) {
        const code = error instanceof Error ? error.message : ""
        throw new Error(copy.errors[code] ?? code)
      }
    },
  }
}

export function buildPiResourcePathToggleStep(
  path: string,
  reviewedContent: string,
  source: string,
  kind: PiResourceKind,
  resourcePath: string,
  enabled: boolean,
  copy: PiManagementCopy,
  delta = false
): StepDescriptor {
  const expectedHash = piSettingsHash(reviewedContent)
  return {
    kind: "mergeFile",
    id: `pi-package-resource-${kind}-${source}-${resourcePath}`,
    label: copy.resourceAction(enabled, resourcePath, source),
    path,
    writtenNote: copy.resourceAction(enabled, resourcePath, source),
    merge: (existing) => {
      if (existing !== reviewedContent || piSettingsHash(existing) !== expectedHash) {
        throw new Error(copy.errors.PI_SETTINGS_CHANGED)
      }
      try {
        return setPackageResourcePathEnabled(existing, source, kind, resourcePath, enabled, delta)
      } catch (error) {
        const code = error instanceof Error ? error.message : ""
        throw new Error(copy.errors[code] ?? code)
      }
    },
  }
}
