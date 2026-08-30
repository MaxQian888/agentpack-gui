export type PiScanScope = { kind: "global" } | { kind: "project"; cwd: string }

export type PiResourceKind = "extensions" | "skills" | "prompts" | "themes"

export interface PiResourceState {
  enabled: boolean
  configured: boolean
  filters: string[]
  declared: string[]
}

export interface PiPackageRecord {
  source: string
  identity: string
  sourceKind: "npm" | "git" | "local"
  pinned: boolean
  autoload: boolean
  scope: "global" | "project"
  inherited: boolean
  overridden: boolean
  installed: boolean
  installedPath?: string
  version?: string
  resources: Record<PiResourceKind, PiResourceState>
}

export interface PiTrustStatus {
  state: "trusted" | "untrusted" | "ask" | string
  source: "saved" | "default" | string
}

export interface PiPackageSnapshot {
  installed: boolean
  scope: "global" | "project"
  cwd?: string
  settingsPath: string
  packages: PiPackageRecord[]
  trust: PiTrustStatus
  errors: string[]
}

export interface PiPackageSearchItem {
  source: string
  name: string
  version: string
  description: string
  publisher: string
  license: string
  repository?: string
  publishedAt?: string
  resources: PiResourceKind[]
}

export interface PiAuthProviderStatus {
  provider: string
  status: string
  reason?: string
  authType?: string
  expiresAt?: number
  source: string
}

export interface PiAuthReport {
  installed: boolean
  providers: PiAuthProviderStatus[]
}
