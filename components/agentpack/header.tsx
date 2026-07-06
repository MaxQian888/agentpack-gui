"use client"

import { ChevronDown, Download, Moon, Play, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PRESETS } from "@/lib/agentpack/presets"
import { useLocale, useT } from "@/lib/i18n/provider"
import type { Lang } from "@/lib/i18n/types"
import type { OS } from "@/lib/agentpack/types"
import { useAppStore } from "@/store/app-store"
import { HelpTip } from "./help-tip"

const OS_OPTIONS: OS[] = ["win", "mac", "linux"]

export function Header({
  onRun,
  onQuickInstall,
  onCustomize,
  onShowUpdates,
}: {
  onRun: () => void
  /** Apply a preset bundle and run it in one click (from the Run ▾ menu). */
  onQuickInstall?: (presetId: string) => void
  /** Open the one-page quick-install (customize) dialog. */
  onCustomize?: () => void
  onShowUpdates?: () => void
}) {
  const t = useT()
  const { lang, setLang } = useLocale()
  const { resolvedTheme, setTheme } = useTheme()
  const dryRun = useAppStore((s) => s.dryRun)
  const toggleDryRun = useAppStore((s) => s.toggleDryRun)
  const osOverride = useAppStore((s) => s.osOverride)
  const setOsOverride = useAppStore((s) => s.setOsOverride)
  const hasUpdate = useAppStore((s) => s.hasUpdate())
  const updateVersion = useAppStore((s) => s.updateInfo?.version)

  return (
    <header className="flex items-center gap-4 border-b px-6 py-3">
      <div data-tour="preview" className="flex items-center gap-2">
        <Switch id="dry-run" checked={dryRun} onCheckedChange={toggleDryRun} />
        <Label htmlFor="dry-run" className="cursor-pointer text-sm">
          {t.shell.preview}
        </Label>
        <HelpTip text={t.help.dryRun} />
      </div>

      <div className="ml-auto flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t.shell.osOverride}</span>
          <Select
            value={osOverride ?? "auto"}
            onValueChange={(v) => setOsOverride(v === "auto" ? null : (v as OS))}
          >
            <SelectTrigger size="sm" className="w-28" aria-label={t.shell.osOverride}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{t.shell.osAuto}</SelectItem>
              {OS_OPTIONS.map((os) => (
                <SelectItem key={os} value={os}>
                  {os}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Select value={lang} onValueChange={(v) => setLang(v as Lang)}>
          <SelectTrigger size="sm" className="w-24" aria-label={t.shell.language}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">EN</SelectItem>
            <SelectItem value="zh-CN">中文</SelectItem>
          </SelectContent>
        </Select>

        {hasUpdate && onShowUpdates ? (
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={updateVersion ? t.about.updateAvailable(updateVersion) : t.menu.about}
            onClick={onShowUpdates}
          >
            <Download className="size-4" />
            <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary" />
          </Button>
        ) : null}

        <Button
          variant="ghost"
          size="icon"
          aria-label={t.shell.toggleTheme}
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          <Sun className="size-4 dark:hidden" />
          <Moon className="hidden size-4 dark:block" />
        </Button>

        {onQuickInstall && onCustomize ? (
          <ButtonGroup data-tour="run">
            <Button onClick={onRun} className="gap-2">
              <Play className="size-4" />
              {t.shell.run}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" aria-label={t.shell.quickInstall}>
                  <ChevronDown className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>{t.shell.quickInstall}</DropdownMenuLabel>
                {PRESETS.map((p) => (
                  <DropdownMenuItem key={p.id} onSelect={() => onQuickInstall(p.id)}>
                    {t.presets[p.id]?.title ?? p.id}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onCustomize()}>
                  {t.shell.customize}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </ButtonGroup>
        ) : (
          <Button data-tour="run" onClick={onRun} className="gap-2">
            <Play className="size-4" />
            {t.shell.run}
          </Button>
        )}
      </div>
    </header>
  )
}
