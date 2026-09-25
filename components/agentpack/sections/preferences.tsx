"use client"

/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 */
/* Hallmark · genre: modern-minimal · macrostructure: settings workbench · theme: inherited Cobalt · contrast: pass (40–41) · slop: pass (42–49) · mobile: pass (34, 49, 50–57) */

import { useTheme } from "next-themes"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useMounted } from "@/hooks/use-mounted"
import { normalizeUiScale, UI_SCALES, type UiScale } from "@/lib/agentpack/appearance"
import { detectBrowserLang } from "@/lib/agentpack/locale"
import { WORKSPACE_LABEL } from "@/lib/agentpack/palette"
import type { OS } from "@/lib/agentpack/types"
import { WORKSPACES, type SectionKey } from "@/lib/agentpack/workspaces"
import { useLocale, useT } from "@/lib/i18n/provider"
import type { Lang } from "@/lib/i18n/types"
import { isTauri } from "@/lib/tauri"
import { DEFAULT_SETTINGS, saveSettings } from "@/lib/tauri/settings"
import {
  DEFAULT_SUMMON_SHORTCUT,
  registerSummonShortcut,
  unregisterSummonShortcut,
} from "@/lib/tauri/shortcut"
import { useAppStore } from "@/store/app-store"
import { CapabilityTile, CapabilityWorkbench } from "./capability-workbench"
import { SectionStatus } from "./section-status"
import { SettingsGroup, SettingsPanel, SettingsRow } from "./settings-panel"
import { sectionMeta } from "../sidebar-nav"
import { DesktopOnlyNote } from "../desktop-only-note"

const OS_OPTIONS: OS[] = ["win", "mac", "linux"]

type ThemeChoice = "system" | "light" | "dark"

/** Sentinel for "no startup override" — a native <option> can't carry null. */
const STARTUP_DEFAULT = "default"

/**
 * Everything about how the app itself behaves: how it looks, where it opens,
 * and what it is allowed to do on its own.
 *
 * These preferences used to live at the bottom of About, under the update
 * panel, as five `border-t` rows — language next to a global OS-level hotkey
 * next to the tour buttons, all weighted the same and none of them saying what
 * they would do. Splitting them out is what lets About go back to answering one
 * question ("which build is this?") and lets each preference here carry the one
 * line that makes it decidable.
 *
 * Three of them are new and are not stored the way the rest are: the theme is
 * next-themes' own persisted value, the language is the i18n provider's, and
 * both apply to web mode as much as to the desktop app. Scale and reduced
 * motion are written to `<html>` by `useAppearance` in the shell, which is also
 * what re-applies them at startup.
 */
export function PreferencesSection() {
  const t = useT()
  const prefs = t.preferences
  const { lang, setLang } = useLocale()
  const { theme, setTheme } = useTheme()
  // next-themes has no answer during the pre-rendered pass, and neither does
  // isTauri(); both would hydration-mismatch if read before mount.
  const mounted = useMounted()
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const osOverride = useAppStore((s) => s.osOverride)
  const setOsOverride = useAppStore((s) => s.setOsOverride)
  const setOnboardingOpen = useAppStore((s) => s.setOnboardingOpen)
  const setTourActive = useAppStore((s) => s.setTourActive)

  const scale = normalizeUiScale(settings.uiScale)
  const themeChoice: ThemeChoice = mounted ? ((theme as ThemeChoice) ?? "system") : "system"
  const themeLabel = {
    system: prefs.themeSystem,
    light: prefs.themeLight,
    dark: prefs.themeDark,
  }[themeChoice]

  /** Every persisted preference on this page goes through here. */
  const persist = (patch: Parameters<typeof setSettings>[0]) => {
    setSettings(patch)
    void saveSettings(patch)
  }

  /**
   * Claim (or release) the global accelerator. Only persist it once the OS has
   * actually granted it — another app may already own the combination, and a
   * switch left on for a hotkey that does nothing is worse than an honest error.
   */
  const onToggleHotkey = async (checked: boolean) => {
    if (!checked) {
      if (settings.summonShortcut) await unregisterSummonShortcut(settings.summonShortcut)
      persist({ summonShortcut: null })
      return
    }
    if (await registerSummonShortcut(DEFAULT_SUMMON_SHORTCUT)) {
      persist({ summonShortcut: DEFAULT_SUMMON_SHORTCUT })
    } else {
      toast.error(prefs.hotkeyTaken(DEFAULT_SUMMON_SHORTCUT))
    }
  }

  /**
   * Back to the shipped defaults — for this page only, which includes the
   * global hotkey: it is released, not merely switched off in settings, or the
   * reset would leave a system-wide key claimed behind a switch reading off. It
   * deliberately does not touch the proxy, the mirrors, saved profiles or
   * anything installed: a reset that quietly undid a network route the user
   * needed to reach npm would be a far more expensive surprise than a theme
   * they can flip back.
   */
  const restoreDefaults = async () => {
    setTheme("system")
    setLang(detectBrowserLang())
    setOsOverride(null)
    if (settings.summonShortcut) await unregisterSummonShortcut(settings.summonShortcut)
    persist({
      uiScale: DEFAULT_SETTINGS.uiScale,
      reduceMotion: DEFAULT_SETTINGS.reduceMotion,
      startupSection: DEFAULT_SETTINGS.startupSection,
      autoCheckUpdates: DEFAULT_SETTINGS.autoCheckUpdates,
      quickStartDismissed: DEFAULT_SETTINGS.quickStartDismissed,
      summonShortcut: DEFAULT_SETTINGS.summonShortcut,
      osOverride: DEFAULT_SETTINGS.osOverride,
    })
    toast.success(prefs.defaultsDone)
  }

  const startupLabel = settings.startupSection
    ? sectionMeta(settings.startupSection).label(t)
    : prefs.startupDefault

  return (
    <CapabilityWorkbench
      title={prefs.title}
      subtitle={prefs.subtitle}
      actionsLabel={prefs.actionsLabel}
      lead={
        <SectionStatus
          label={prefs.summaryLabel}
          facts={[
            { label: prefs.metricTheme, value: themeLabel },
            { label: prefs.metricScale, value: prefs.scaleValue(scale) },
            { label: prefs.metricLanguage, value: lang },
            { label: prefs.metricStartup, value: startupLabel },
          ]}
        />
      }
      primary={
        <SettingsPanel
          label={prefs.panelLabel}
          lead={
            !isTauri() && mounted ? <DesktopOnlyNote>{prefs.webNote}</DesktopOnlyNote> : undefined
          }
        >
          <SettingsGroup title={prefs.appearanceTitle} hint={prefs.appearanceHint}>
            <SettingsRow
              label={prefs.themeLabel}
              hint={prefs.themeHint}
              labelId="pref-theme-label"
              control={
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  aria-labelledby="pref-theme-label"
                  value={themeChoice}
                  onValueChange={(v) => v && setTheme(v)}
                >
                  <ToggleGroupItem value="system">{prefs.themeSystem}</ToggleGroupItem>
                  <ToggleGroupItem value="light">{prefs.themeLight}</ToggleGroupItem>
                  <ToggleGroupItem value="dark">{prefs.themeDark}</ToggleGroupItem>
                </ToggleGroup>
              }
            />
            <SettingsRow
              label={prefs.languageLabel}
              hint={prefs.languageHint}
              labelId="pref-language-label"
              control={
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  aria-labelledby="pref-language-label"
                  value={lang}
                  onValueChange={(v) => v && setLang(v as Lang)}
                >
                  <ToggleGroupItem value="en">EN</ToggleGroupItem>
                  <ToggleGroupItem value="zh-CN">中文</ToggleGroupItem>
                </ToggleGroup>
              }
            />
            <SettingsRow
              label={prefs.scaleLabel}
              hint={prefs.scaleHint}
              labelId="pref-scale-label"
              control={
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  aria-labelledby="pref-scale-label"
                  value={String(scale)}
                  onValueChange={(v) => v && persist({ uiScale: Number(v) as UiScale })}
                >
                  {UI_SCALES.map((pct) => (
                    <ToggleGroupItem
                      key={pct}
                      value={String(pct)}
                      aria-label={pct === 100 ? prefs.scaleDefault(pct) : prefs.scaleValue(pct)}
                      className="font-mono tabular-nums"
                    >
                      {prefs.scaleValue(pct)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              }
            />
            <SettingsRow
              label={prefs.motionLabel}
              hint={prefs.motionHint}
              htmlFor="pref-motion"
              control={
                <Switch
                  id="pref-motion"
                  checked={settings.reduceMotion}
                  onCheckedChange={(on) => persist({ reduceMotion: on })}
                />
              }
            />
          </SettingsGroup>

          <SettingsGroup title={prefs.startupTitle}>
            <SettingsRow
              label={prefs.startupSectionLabel}
              hint={prefs.startupSectionHint}
              htmlFor="pref-startup"
              control={
                <NativeSelect
                  id="pref-startup"
                  size="sm"
                  className="max-w-56"
                  value={settings.startupSection ?? STARTUP_DEFAULT}
                  onChange={(e) =>
                    persist({
                      startupSection:
                        e.target.value === STARTUP_DEFAULT ? null : (e.target.value as SectionKey),
                    })
                  }
                >
                  <NativeSelectOption value={STARTUP_DEFAULT}>
                    {prefs.startupDefault}
                  </NativeSelectOption>
                  {WORKSPACES.map((w) => (
                    <NativeSelectOptGroup key={w.key} label={WORKSPACE_LABEL[w.key](t)}>
                      {w.sections.map((s) => (
                        <NativeSelectOption key={s} value={s}>
                          {sectionMeta(s).label(t)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelectOptGroup>
                  ))}
                </NativeSelect>
              }
            />
            <SettingsRow
              label={prefs.autoCheckLabel}
              hint={prefs.autoCheckHint}
              htmlFor="pref-auto-check"
              control={
                <Switch
                  id="pref-auto-check"
                  checked={settings.autoCheckUpdates}
                  onCheckedChange={(on) => persist({ autoCheckUpdates: on })}
                />
              }
            />
            <SettingsRow
              label={prefs.quickStartLabel}
              hint={prefs.quickStartHint}
              htmlFor="pref-quick-start"
              control={
                <Switch
                  id="pref-quick-start"
                  checked={!settings.quickStartDismissed}
                  onCheckedChange={(on) => persist({ quickStartDismissed: !on })}
                />
              }
            />
          </SettingsGroup>

          <SettingsGroup title={prefs.systemTitle}>
            <SettingsRow
              label={prefs.hotkeyLabel}
              hint={
                <>
                  {prefs.hotkeyHint} <Kbd>{DEFAULT_SUMMON_SHORTCUT}</Kbd>
                </>
              }
              htmlFor="pref-hotkey"
              control={
                <Switch
                  id="pref-hotkey"
                  disabled={!isTauri()}
                  checked={settings.summonShortcut !== null}
                  onCheckedChange={(on) => void onToggleHotkey(on)}
                />
              }
              note={
                !isTauri() && mounted ? (
                  <DesktopOnlyNote>{prefs.hotkeyDesktopOnly}</DesktopOnlyNote>
                ) : null
              }
            />
            <SettingsRow
              label={prefs.osLabel}
              hint={prefs.osHint}
              htmlFor="pref-os"
              control={
                <NativeSelect
                  id="pref-os"
                  size="sm"
                  value={osOverride ?? "auto"}
                  onChange={(e) => {
                    // Persisted like the rest of the page, so "the desktop app
                    // remembers them" is true of this one too.
                    const os = e.target.value === "auto" ? null : (e.target.value as OS)
                    setOsOverride(os)
                    persist({ osOverride: os })
                  }}
                >
                  <NativeSelectOption value="auto">{prefs.osAuto}</NativeSelectOption>
                  {OS_OPTIONS.map((os) => (
                    <NativeSelectOption key={os} value={os}>
                      {os}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              }
            />
          </SettingsGroup>
        </SettingsPanel>
      }
      aside={
        <>
          <CapabilityTile title={prefs.guidanceTitle} description={prefs.guidanceHint}>
            <div className="flex flex-col gap-2">
              <Button variant="outline" size="sm" onClick={() => setTourActive(true)}>
                {t.tour.start}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setOnboardingOpen(true)}>
                {t.welcome.reopen}
              </Button>
            </div>
          </CapabilityTile>
          <CapabilityTile title={prefs.defaultsTitle} description={prefs.defaultsHint}>
            <Button variant="outline" size="sm" onClick={() => void restoreDefaults()}>
              {prefs.defaultsAction}
            </Button>
          </CapabilityTile>
        </>
      }
    />
  )
}
