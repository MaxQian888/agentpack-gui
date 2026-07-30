"use client"

import { useState } from "react"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  fieldOptions,
  getConfigValue,
  isPathEditable,
  isProviderScoped,
  resolveFieldPath,
  setConfigValue,
  type ConfigDoc,
  type ConfigField,
  type ConfigSection,
} from "@/lib/agentpack/config-editor/schema"

/** Parse a comma/newline-separated input into a string array (or undefined). */
function parseStringList(input: string): string[] | undefined {
  const items = input
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
  return items.length ? items : undefined
}

/** Render a string array back into a comma-separated input value. */
function stringListValue(value: unknown): string {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string").join(", ") : ""
}

/** Sentinel for "key absent" in Radix Select (it rejects empty item values). */
const UNSET = "unset"

/**
 * Text input backing a string array. It keeps the *typed* text locally so
 * separators aren't normalized away mid-typing, and only re-adopts the external
 * value when the doc changes to a genuinely different list (e.g. on reload).
 */
function StringListField({
  id,
  label,
  placeholder,
  disabled,
  value,
  onChange,
}: {
  id: string
  label: string
  placeholder?: string
  disabled?: boolean
  value: unknown
  onChange: (list: string[] | undefined) => void
}) {
  const external = stringListValue(value)
  const [text, setText] = useState(external)
  const [prevExternal, setPrevExternal] = useState(external)
  if (external !== prevExternal) {
    setPrevExternal(external)
    if (stringListValue(parseStringList(text)) !== external) setText(external)
  }
  return (
    <div className="flex items-center justify-between gap-2">
      <Label htmlFor={id} className="text-xs font-normal">
        {label}
      </Label>
      <Input
        id={id}
        className="h-8 w-56 text-xs"
        placeholder={placeholder}
        disabled={disabled}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          onChange(parseStringList(e.target.value))
        }}
      />
    </div>
  )
}

interface MapRow {
  k: string
  v: string
}

function rowsFromValue(value: unknown): MapRow[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  return Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => typeof v === "string")
    .map(([k, v]) => ({ k, v: v as string }))
}

/** Order-independent identity of a map, for comparing local rows against the doc. */
function canonicalMap(entries: [string, string][]): string {
  return JSON.stringify([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

function commitRows(rows: MapRow[]): [string, string][] {
  // A half-typed row has no key yet; dropping it here (rather than in state) is
  // what lets the user type a key one character at a time without the row
  // vanishing and reappearing under the caret.
  return rows.filter((r) => r.k.trim()).map((r) => [r.k.trim(), r.v] as [string, string])
}

/**
 * Key/value rows backing a table of strings (`env`, header maps). Same
 * discipline as StringListField: rows live in local state so an in-progress edit
 * survives, and the external value is only re-adopted when the doc genuinely
 * describes a different map.
 */
function StringMapField({
  id,
  label,
  disabled,
  value,
  onChange,
  labels,
}: {
  id: string
  label: string
  disabled?: boolean
  value: unknown
  onChange: (map: Record<string, string>) => void
  labels: MapLabels
}) {
  const external = canonicalMap(rowsFromValue(value).map((r) => [r.k, r.v]))
  const [rows, setRows] = useState<MapRow[]>(() => rowsFromValue(value))
  const [prevExternal, setPrevExternal] = useState(external)
  if (external !== prevExternal) {
    setPrevExternal(external)
    if (canonicalMap(commitRows(rows)) !== external) setRows(rowsFromValue(value))
  }

  const apply = (next: MapRow[]) => {
    setRows(next)
    onChange(Object.fromEntries(commitRows(next)))
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${id}-k-0`} className="text-xs font-normal">
        {label}
      </Label>
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-1">
          <Input
            id={`${id}-k-${i}`}
            aria-label={`${label} ${labels.key} ${i + 1}`}
            className="h-8 flex-1 text-xs"
            placeholder={labels.key}
            disabled={disabled}
            value={row.k}
            onChange={(e) => apply(rows.map((r, j) => (j === i ? { ...r, k: e.target.value } : r)))}
          />
          <Input
            aria-label={`${label} ${labels.value} ${i + 1}`}
            className="h-8 flex-1 text-xs"
            placeholder={labels.value}
            disabled={disabled}
            value={row.v}
            onChange={(e) => apply(rows.map((r, j) => (j === i ? { ...r, v: e.target.value } : r)))}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8 shrink-0"
            aria-label={`${labels.remove} ${row.k || i + 1}`}
            disabled={disabled}
            onClick={() => apply(rows.filter((_, j) => j !== i))}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 gap-1 text-xs"
        disabled={disabled}
        onClick={() => setRows([...rows, { k: "", v: "" }])}
      >
        <Plus className="size-3" />
        {labels.add}
      </Button>
    </div>
  )
}

export interface MapLabels {
  add: string
  remove: string
  key: string
  value: string
}

interface Props {
  /** Namespaces the generated input ids (`ccconf` keeps cc-connect's existing ids). */
  idPrefix: string
  sections: ConfigSection[]
  doc: ConfigDoc
  /** Receives the next doc; the caller re-serializes it into the raw text. */
  onChange: (next: ConfigDoc) => void
  labels: Record<string, string>
  sectionLabels: Record<string, string>
  unsetLabel: string
  /** Shown when the on-disk value's shape is one this widget cannot express. */
  lockedHint: string
  /** Shown when a `[section.<provider>]` field has no provider chosen yet. */
  providerFirstHint: string
  mapLabels: MapLabels
}

/**
 * Renders a schema's sections as form controls over `doc`. Every control writes
 * through `setConfigValue`, so a field the schema doesn't model is never touched
 * and unknown keys survive the round-trip.
 */
export function ConfigFormFields({
  idPrefix,
  sections,
  doc,
  onChange,
  labels,
  sectionLabels,
  unsetLabel,
  lockedHint,
  providerFirstHint,
  mapLabels,
}: Props) {
  const setField = (field: ConfigField, value: unknown) => {
    const path = resolveFieldPath(doc, field.path)
    if (!path) return // provider-scoped field with no provider chosen yet
    onChange(setConfigValue(doc, path, value))
  }

  const renderField = (sectionKey: string, field: ConfigField) => {
    const id = `${idPrefix}-${sectionKey}-${field.key}`
    const label = labels[field.key] ?? field.key
    const path = resolveFieldPath(doc, field.path)
    // A `[section.<provider>]` credential field has nowhere to write until its
    // provider is picked; a union-typed value has a shape this widget would
    // flatten. Both disable the control, but they need different explanations.
    const providerLocked = isProviderScoped(field) && !path
    const shapeLocked = !!path && !isPathEditable(doc, path, field.type)
    const locked = providerLocked || shapeLocked
    const hint = providerLocked ? providerFirstHint : shapeLocked ? lockedHint : field.placeholder
    const value = path ? getConfigValue(doc, path) : undefined

    switch (field.type) {
      case "boolean":
        return (
          <div key={id} className="flex items-center justify-between gap-2">
            <Label htmlFor={id} className="text-xs font-normal">
              {label}
            </Label>
            <Switch
              id={id}
              checked={value === true}
              disabled={locked}
              title={locked ? hint : undefined}
              onCheckedChange={(on) => setField(field, on)}
            />
          </div>
        )
      case "number":
        return (
          <div key={id} className="flex items-center justify-between gap-2">
            <Label htmlFor={id} className="text-xs font-normal">
              {label}
            </Label>
            <Input
              id={id}
              type="number"
              className="h-8 w-32 text-xs"
              disabled={locked}
              placeholder={locked ? hint : field.placeholder}
              value={typeof value === "number" ? value : ""}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10)
                setField(field, Number.isNaN(n) ? undefined : n)
              }}
            />
          </div>
        )
      case "select": {
        const options = fieldOptions(doc, field, value)
        return (
          <div key={id} className="flex items-center justify-between gap-2">
            <Label htmlFor={id} className="text-xs font-normal">
              {label}
            </Label>
            <Select
              value={typeof value === "string" && value !== "" ? value : UNSET}
              disabled={locked}
              onValueChange={(v) => setField(field, v === UNSET ? undefined : v)}
            >
              <SelectTrigger
                id={id}
                size="sm"
                className="w-40 text-xs"
                title={locked ? hint : undefined}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((opt) =>
                  opt === "" ? (
                    <SelectItem key={UNSET} value={UNSET}>
                      {unsetLabel}
                    </SelectItem>
                  ) : (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  )
                )}
                {options.includes("") ? null : <SelectItem value={UNSET}>{unsetLabel}</SelectItem>}
              </SelectContent>
            </Select>
          </div>
        )
      }
      case "string-list":
        return (
          <StringListField
            key={id}
            id={id}
            label={label}
            placeholder={locked ? hint : field.placeholder}
            disabled={locked}
            value={value}
            onChange={(list) => setField(field, list)}
          />
        )
      case "string-map":
        return (
          <StringMapField
            key={id}
            id={id}
            label={label}
            disabled={locked}
            value={value}
            onChange={(map) => setField(field, map)}
            labels={mapLabels}
          />
        )
      default:
        return (
          <div key={id} className="flex items-center justify-between gap-2">
            <Label htmlFor={id} className="text-xs font-normal">
              {label}
            </Label>
            <Input
              id={id}
              className="h-8 w-56 text-xs"
              placeholder={locked ? hint : field.placeholder}
              disabled={locked}
              value={typeof value === "string" ? value : ""}
              onChange={(e) => setField(field, e.target.value)}
            />
          </div>
        )
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {sections.map((section) => (
        <div key={section.key} className="space-y-2 rounded-md border p-3">
          <div className="text-xs font-medium">{sectionLabels[section.key] ?? section.key}</div>
          {section.fields.map((f) => renderField(section.key, f))}
        </div>
      ))}
    </div>
  )
}
