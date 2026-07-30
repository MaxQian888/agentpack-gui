import { en } from "@/lib/i18n/en"
import { zhCN } from "@/lib/i18n/zh-CN"
import { allFields, allSectionKeys, CONFIG_FILES } from "./files"
import { getConfigValue, setConfigValue, type FieldType } from "./schema"

const CATALOGS = [
  ["en", en.configFiles],
  ["zh-CN", zhCN.configFiles],
] as const

describe("CONFIG_FILES shape", () => {
  it("covers the four agent config files with distinct path keys", () => {
    expect(CONFIG_FILES).toHaveLength(4)
    const keys = CONFIG_FILES.map((f) => f.pathKey)
    expect(new Set(keys).size).toBe(keys.length)
    expect(CONFIG_FILES.map((f) => f.id)).toEqual(keys)
  })

  it("keeps ~/.claude.json read-only, volatile and small-capped", () => {
    const claudeConfig = CONFIG_FILES.find((f) => f.id === "claudeConfig")!
    expect(claudeConfig.form.kind).toBe("mcpInventory")
    expect(claudeConfig.volatile).toBe(true)
    expect(claudeConfig.rawLimitBytes).toBeLessThan(1_000_000)
  })
})

describe("i18n coverage", () => {
  it.each(CATALOGS)("%s labels every field", (_name, catalog) => {
    const missing = allFields()
      .map((f) => f.key)
      .filter((k) => !(k in catalog.fields))
    expect(missing).toEqual([])
  })

  it.each(CATALOGS)("%s labels every section", (_name, catalog) => {
    const missing = allSectionKeys().filter((k) => !(k in catalog.sections))
    expect(missing).toEqual([])
  })

  it.each(CATALOGS)("%s titles every file", (_name, catalog) => {
    const missing = CONFIG_FILES.map((f) => f.id).filter((id) => !(id in catalog.files))
    expect(missing).toEqual([])
  })

  it("carries no field label the schema no longer uses", () => {
    const used = new Set(allFields().map((f) => f.key))
    expect(Object.keys(en.configFiles.fields).filter((k) => !used.has(k))).toEqual([])
  })
})

describe("schema hygiene", () => {
  it("keeps field keys globally unique so the i18n map can stay flat", () => {
    const keys = allFields().map((f) => f.key)
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i)
    expect(dupes).toEqual([])
  })

  it("gives every select a way back to unset", () => {
    // Without an "" entry (or a table-derived list that can be empty), a value
    // the user set could never be cleared from the form.
    const stuck = allFields()
      .filter((f) => f.type === "select")
      .filter((f) => !(f.options ?? []).includes("") && !f.optionsFrom)
      .map((f) => f.key)
    expect(stuck).toEqual([])
  })

  it("never lets one field path be a prefix of another", () => {
    // A scalar at ["statusLine"] plus one at ["statusLine","command"] would have
    // the outer widget clobber the inner table on every edit.
    const paths = allFields().map((f) => f.path)
    const collisions: string[] = []
    for (const a of paths) {
      for (const b of paths) {
        if (a === b || a.length >= b.length) continue
        if (a.every((seg, i) => seg === b[i])) collisions.push(`${a.join(".")} ⊂ ${b.join(".")}`)
      }
    }
    expect(collisions).toEqual([])
  })
})

const SAMPLE: Record<FieldType, unknown> = {
  string: "sample",
  number: 42,
  boolean: true,
  select: "sample",
  "string-list": ["a", "b"],
  "string-map": { A: "1" },
}

describe("round-trip smoke", () => {
  // Catches a path segment the format can't express (a TOML key needing quotes,
  // a JSON typo) before it reaches a user's real config file.
  it.each(CONFIG_FILES.filter((f) => f.form.kind === "fields"))(
    "$id writes and reads back every field",
    (def) => {
      if (def.form.kind !== "fields") throw new Error("filtered above")
      for (const section of def.form.sections) {
        for (const field of section.fields) {
          const sample = SAMPLE[field.type]
          const text = def.format.serialize(setConfigValue({}, field.path, sample))
          const doc = def.format.parse(text)
          expect({ key: field.key, doc: doc && getConfigValue(doc, field.path) }).toEqual({
            key: field.key,
            doc: sample,
          })
        }
      }
    }
  )
})
