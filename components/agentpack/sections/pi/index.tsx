"use client"

import { useState } from "react"
import { ExternalLink, FolderOpen, RefreshCw, Search } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  isPiExactResourcePath,
  piResourcePathEnabled,
  redactPiPackageSource,
  type PiPackageAction,
} from "@/lib/pi/management"
import type { PiPackageRecord, PiResourceKind } from "@/lib/pi/types"
import { useT } from "@/lib/i18n/provider"
import { openUrl } from "@/lib/tauri/system"
import type { PiManagementController } from "../../pi-controller"

const RESOURCE_KINDS: PiResourceKind[] = ["extensions", "skills", "prompts", "themes"]

export function PiSection({
  controller,
  onOpenClis,
}: {
  controller: PiManagementController
  onOpenClis: () => void
}) {
  const m = useT().pi
  const {
    paths,
    installed,
    tab,
    setTab,
    scopeKind,
    setScopeKind,
    cwd,
    setCwd,
    projects,
    snapshot,
    auth,
    loading,
    source,
    setSource,
    query,
    setQuery,
    results,
    searching,
    pending,
    setPending,
    sessionDirs,
    scan,
    loadAuth,
    chooseProject,
    searchPackages,
    addSessionDir,
    removeSessionDir,
    stagePackageAction,
    toggleResource,
    toggleResourcePath,
    openInteractive,
  } = controller

  if (!installed) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold">{m.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{m.subtitle}</p>
        </div>
        <Alert>
          <AlertTitle>Pi</AlertTitle>
          <AlertDescription className="mt-3 flex items-center justify-between gap-4">
            <span>{m.notInstalled}</span>
            <Button onClick={onOpenClis}>{m.installPi}</Button>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{m.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{m.subtitle}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void (tab === "authentication" ? loadAuth(false) : scan())}
          disabled={loading}
        >
          <RefreshCw className="size-4" /> {m.refresh}
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="packages">{m.packages}</TabsTrigger>
          <TabsTrigger value="authentication">{m.authentication}</TabsTrigger>
        </TabsList>

        <TabsContent value="packages" className="space-y-4 pt-3">
          <Card>
            <CardHeader>
              <CardTitle>{m.scope}</CardTitle>
              <CardDescription>
                {snapshot?.scope === "project"
                  ? `${m.trust}: ${snapshot.trust.state}`
                  : m.globalScope}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2">
              <Button
                variant={scopeKind === "global" ? "default" : "outline"}
                size="sm"
                onClick={() => setScopeKind("global")}
              >
                {m.globalScope}
              </Button>
              <Button
                variant={scopeKind === "project" ? "default" : "outline"}
                size="sm"
                onClick={() => setScopeKind("project")}
              >
                {m.projectScope}
              </Button>
              {scopeKind === "project" ? (
                <>
                  <Input
                    aria-label={m.projectFolder}
                    list="pi-project-folders"
                    value={cwd}
                    onChange={(event) => setCwd(event.target.value)}
                    className="min-w-64 flex-1"
                    placeholder={m.projectFolder}
                  />
                  <datalist id="pi-project-folders">
                    {projects.map((project) => (
                      <option key={project} value={project} />
                    ))}
                  </datalist>
                  <Button variant="outline" size="sm" onClick={() => void chooseProject()}>
                    <FolderOpen className="size-4" /> {m.chooseFolder}
                  </Button>
                </>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{m.sessionFolders}</CardTitle>
              <CardDescription>{m.sessionFoldersHint}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {sessionDirs.map((dir) => (
                <div key={dir} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-mono text-xs">{dir}</span>
                  <Button variant="ghost" size="sm" onClick={() => void removeSessionDir(dir)}>
                    {m.remove}
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => void addSessionDir()}>
                <FolderOpen className="size-4" /> {m.addSessionFolder}
              </Button>
            </CardContent>
          </Card>

          <Alert variant="destructive">
            <AlertTitle>{m.communityWarning}</AlertTitle>
            <AlertDescription>
              {m.permissionBody(m.packages, snapshot?.settingsPath ?? paths?.piSettings ?? "")}
            </AlertDescription>
          </Alert>

          <div className="flex flex-wrap gap-2">
            <Input
              aria-label={m.addSource}
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder={m.addSource}
              className="min-w-72 flex-1"
            />
            <Button
              disabled={!source.trim()}
              onClick={() =>
                setPending({
                  action: { kind: "install", source: source.trim() },
                  source: source.trim(),
                  scope: scopeKind,
                })
              }
            >
              {m.install}
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                setPending({
                  action: { kind: "updateAll" },
                  source: m.allPackages,
                  scope: scopeKind,
                })
              }
            >
              {m.updateAll}
            </Button>
          </div>

          <div className="space-y-3">
            {snapshot?.errors.map((error) => (
              <Alert key={error} variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ))}
            {snapshot && snapshot.packages.length === 0 ? (
              <p className="text-sm text-muted-foreground">{m.noPackages}</p>
            ) : null}
            {snapshot?.packages.map((pkg) => (
              <PackageCard
                key={`${pkg.scope}:${pkg.source}`}
                pkg={pkg}
                onAction={(action) => setPending({ action, source: pkg.source, scope: pkg.scope })}
                onToggle={(kind, enabled) => void toggleResource(pkg, kind, enabled)}
                onPathToggle={(kind, resourcePath, enabled) =>
                  void toggleResourcePath(pkg, kind, resourcePath, enabled)
                }
              />
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{m.browse}</CardTitle>
              <CardDescription>{m.communityWarning}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && void searchPackages()}
                />
                <Button onClick={() => void searchPackages()} disabled={searching || !query.trim()}>
                  <Search className="size-4" /> {m.search}
                </Button>
                <Button variant="ghost" onClick={() => void openUrl("https://pi.dev/packages")}>
                  <ExternalLink className="size-4" /> {m.gallery}
                </Button>
              </div>
              {results.length === 0 && query && !searching ? (
                <p className="text-sm text-muted-foreground">{m.noResults}</p>
              ) : null}
              {results.map((item) => (
                <div
                  key={item.source}
                  className="flex items-start justify-between gap-4 rounded-lg border p-3"
                >
                  <div>
                    <div className="font-medium">
                      {item.name}{" "}
                      <span className="text-xs text-muted-foreground">{item.version}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.publisher} · {item.license || "—"} · {item.resources.join(", ")}
                    </p>
                    {item.publishedAt ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {m.published}: {new Date(item.publishedAt).toLocaleDateString()}
                      </p>
                    ) : null}
                    {item.repository ? (
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs"
                        onClick={() => void openUrl(item.repository!)}
                      >
                        {item.repository}
                      </Button>
                    ) : null}
                  </div>
                  <Button
                    size="sm"
                    onClick={() =>
                      setPending({
                        action: { kind: "install", source: item.source },
                        source: item.source,
                        scope: scopeKind,
                      })
                    }
                  >
                    {m.install}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="authentication" className="space-y-4 pt-3">
          <Alert>
            <AlertDescription>{m.authHint}</AlertDescription>
          </Alert>
          <div className="flex gap-2">
            <Button onClick={() => void loadAuth(true)} disabled={loading}>
              {m.refreshAuth}
            </Button>
            <Button variant="outline" onClick={() => void openInteractive("/login")}>
              {m.login}
            </Button>
            <Button variant="outline" onClick={() => void openInteractive("/logout")}>
              {m.logout}
            </Button>
          </div>
          <Card>
            <CardContent className="pt-0">
              <div className="divide-y">
                <div className="grid grid-cols-5 gap-3 py-3 text-xs font-medium text-muted-foreground">
                  <span>{m.provider}</span>
                  <span>{m.status}</span>
                  <span>{m.authType}</span>
                  <span>{m.source}</span>
                  <span>{m.expires}</span>
                </div>
                {auth?.providers.map((provider) => (
                  <div key={provider.provider} className="grid grid-cols-5 gap-3 py-3 text-sm">
                    <span className="font-medium">{provider.provider}</span>
                    <span>{m.authStatuses[provider.status] ?? m.unknown}</span>
                    <span>
                      {provider.authType ? (m.authTypes[provider.authType] ?? m.unknown) : "—"}
                    </span>
                    <span>{m.authSources[provider.source] ?? m.unknown}</span>
                    <span>
                      {provider.expiresAt ? new Date(provider.expiresAt).toLocaleString() : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{m.permissionTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {pending
                ? m.permissionBody(
                    redactPiPackageSource(pending.source),
                    pending.scope === "project"
                      ? snapshot?.scope === "project"
                        ? snapshot.settingsPath
                        : `${cwd}/.pi/settings.json`
                      : (paths?.piSettings ?? "")
                  )
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{m.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void stagePackageAction()}>
              {m.approve}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function PackageCard({
  pkg,
  onAction,
  onToggle,
  onPathToggle,
}: {
  pkg: PiPackageRecord
  onAction: (action: PiPackageAction) => void
  onToggle: (kind: PiResourceKind, enabled: boolean) => void
  onPathToggle: (kind: PiResourceKind, resourcePath: string, enabled: boolean) => void
}) {
  const m = useT().pi
  const [replacement, setReplacement] = useState(pkg.source)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span>{pkg.identity}</span>
          <Badge variant="outline">{pkg.sourceKind}</Badge>
          {pkg.version ? <Badge variant="secondary">{pkg.version}</Badge> : null}
          {pkg.pinned ? <Badge>{m.pinned}</Badge> : null}
          {pkg.inherited ? <Badge variant="outline">{m.inherited}</Badge> : null}
          {pkg.overridden ? <Badge variant="outline">{m.overridden}</Badge> : null}
        </CardTitle>
        <CardDescription>
          {pkg.source} · {pkg.installed ? m.installed : m.missing}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {RESOURCE_KINDS.map((kind) => {
            const state = pkg.resources[kind]
            return (
              <div key={kind} className="space-y-2 rounded-md border p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Switch
                    checked={state?.enabled ?? true}
                    disabled={pkg.overridden}
                    onCheckedChange={(enabled) => onToggle(kind, enabled)}
                  />
                  {m.resources[kind] ?? kind}
                  <span className="text-xs text-muted-foreground">
                    {state?.declared.length ?? 0}
                  </span>
                </label>
                {state?.declared.map((resourcePath) => {
                  const enabled =
                    state.enabled &&
                    (!state.configured || piResourcePathEnabled(resourcePath, state.filters))
                  const exact = isPiExactResourcePath(resourcePath)
                  return (
                    <label
                      key={resourcePath}
                      className="flex items-center gap-2 pl-2 text-xs text-muted-foreground"
                    >
                      {exact ? (
                        <Switch
                          checked={enabled}
                          disabled={pkg.overridden}
                          onCheckedChange={(next) => onPathToggle(kind, resourcePath, next)}
                        />
                      ) : null}{" "}
                      <span className="truncate font-mono">{resourcePath}</span>
                    </label>
                  )
                })}
              </div>
            )
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAction({ kind: "remove", source: pkg.source })}
          >
            {m.remove}
          </Button>
          {pkg.pinned ? (
            <>
              <Input
                aria-label={m.changePin}
                value={replacement}
                onChange={(event) => setReplacement(event.target.value)}
                className="h-8 min-w-64 flex-1"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!replacement.trim() || replacement.trim() === pkg.source}
                onClick={() => onAction({ kind: "install", source: replacement.trim() })}
              >
                {m.changePin}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAction({ kind: "update", source: pkg.source })}
            >
              {m.update}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
