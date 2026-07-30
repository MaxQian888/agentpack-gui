import { highlight, HL_TOKEN_CLASS, type HlToken, type TokenKind } from "./highlight"

/** Reassemble token values — highlighting must never drop or reorder characters. */
const text = (toks: HlToken[]) => toks.map((t) => t.value).join("")
/** All values tagged with a given kind. */
const of = (toks: HlToken[], kind: TokenKind) =>
  toks.filter((t) => t.kind === kind).map((t) => t.value)

describe("highlight — losslessness", () => {
  const samples: [string, string][] = [
    ["ts", "const x = 1 // hi\nfunction f(a: number) { return `t${a}` }"],
    ["json", '{\n  "a": 1,\n  "b": [true, null]\n}'],
    ["bash", '#!/bin/bash\nexport FOO="bar"\necho "${FOO}" $HOME $1'],
    ["python", 'def f(x):\n    """doc"""\n    return None  # done'],
    ["toml", '# c\n[server]\nport = 9820\nname = "cc"'],
    ["yaml", "# c\nname: value\nlist:\n  - true"],
    ["diff", "@@ -1 +1 @@\n-old\n+new\n context"],
    ["unknown-lang", 'foo("bar") // 42'],
    ["", "plain text stays plain"],
  ]
  it.each(samples)("preserves every character for %s", (lang, src) => {
    expect(text(highlight(src, lang))).toBe(src)
  })

  it("returns nothing for empty input", () => {
    expect(highlight("", "ts")).toEqual([])
    expect(highlight("", "diff")).toEqual([])
    expect(highlight("", "")).toEqual([])
  })
})

describe("highlight — TypeScript/JavaScript", () => {
  it("colors keywords, strings, numbers, comments and calls", () => {
    const toks = highlight('const n = 42\nfoo("hi") // note', "ts")
    expect(of(toks, "keyword")).toContain("const")
    expect(of(toks, "number")).toContain("42")
    expect(of(toks, "string")).toContain('"hi"')
    expect(of(toks, "function")).toContain("foo")
    expect(of(toks, "comment")).toContain("// note")
  })

  it("colors literals and object keys at line start", () => {
    const toks = highlight("const o = {\n  key: null,\n}", "ts")
    expect(of(toks, "literal")).toContain("null")
    expect(of(toks, "property")).toContain("key")
  })

  it("handles block comments and template strings spanning lines", () => {
    const toks = highlight("/* a\nb */\nconst t = `x\ny`", "ts")
    expect(of(toks, "comment")).toContain("/* a\nb */")
    expect(of(toks, "string")).toContain("`x\ny`")
  })

  it("aliases jsx/tsx/javascript to the JS spec", () => {
    for (const lang of ["jsx", "tsx", "javascript"]) {
      expect(of(highlight("return 1", lang), "keyword")).toContain("return")
    }
  })
})

describe("highlight — JSON", () => {
  it("distinguishes keys from string values", () => {
    const toks = highlight('{ "id": "x", "on": true, "n": 3 }', "json")
    expect(of(toks, "property")).toContain('"id"')
    expect(of(toks, "string")).toContain('"x"')
    expect(of(toks, "literal")).toContain("true")
    expect(of(toks, "number")).toContain("3")
  })
})

describe("highlight — shell", () => {
  it("colors variables, keywords and comments", () => {
    const toks = highlight("# run\nif true; then\n  cd $HOME ${X} $1\nfi", "bash")
    expect(of(toks, "comment")).toContain("# run")
    expect(of(toks, "keyword")).toEqual(expect.arrayContaining(["if", "then", "fi"]))
    expect(of(toks, "variable")).toEqual(expect.arrayContaining(["$HOME", "${X}", "$1"]))
  })

  it("keeps a variable inside a double-quoted string part of the string", () => {
    const toks = highlight('echo "$HOME"', "bash")
    expect(of(toks, "string")).toContain('"$HOME"')
    expect(of(toks, "variable")).toEqual([])
  })
})

describe("highlight — Python", () => {
  it("colors def/keywords, builtins, triple-quoted strings and None", () => {
    const toks = highlight('def f():\n    """d"""\n    return len([None])', "python")
    expect(of(toks, "keyword")).toEqual(expect.arrayContaining(["def", "return"]))
    expect(of(toks, "function")).toContain("f")
    expect(of(toks, "builtin")).toContain("len")
    expect(of(toks, "literal")).toContain("None")
    expect(of(toks, "string")).toContain('"""d"""')
  })
})

describe("highlight — TOML", () => {
  it("colors table headers, keys, values and comments", () => {
    const toks = highlight('# c\n[server]\nport = 9820\nname = "cc"\non = true', "toml")
    expect(of(toks, "comment")).toContain("# c")
    expect(of(toks, "keyword")).toContain("[server]")
    expect(of(toks, "property")).toEqual(expect.arrayContaining(["port", "name", "on"]))
    expect(of(toks, "number")).toContain("9820")
    expect(of(toks, "string")).toContain('"cc"')
    expect(of(toks, "literal")).toContain("true")
  })

  it("treats [[array]] tables as a single header token", () => {
    expect(of(highlight("[[projects]]\nx = 1", "toml"), "keyword")).toContain("[[projects]]")
  })
})

describe("highlight — YAML", () => {
  it("colors leading keys and literals", () => {
    const toks = highlight("# c\nname: cc\nenabled: true", "yaml")
    expect(of(toks, "property")).toEqual(expect.arrayContaining(["name", "enabled"]))
    expect(of(toks, "literal")).toContain("true")
  })
})

describe("highlight — diff", () => {
  it("classifies inserted, deleted, hunk and file-header lines", () => {
    const src = "diff --git a b\n@@ -1 +1 @@\n--- a\n+++ b\n-gone\n+added\n same"
    const toks = highlight(src, "diff")
    expect(of(toks, "meta")).toEqual(
      expect.arrayContaining(["diff --git a b", "@@ -1 +1 @@", "--- a", "+++ b"])
    )
    expect(of(toks, "deleted")).toEqual(["-gone"])
    expect(of(toks, "inserted")).toEqual(["+added"])
    // A context line (leading space) stays plain.
    expect(text(toks)).toContain(" same")
  })

  it("recognizes apply-patch markers", () => {
    expect(of(highlight("*** Update File: a.ts\n@@\n+x", "diff"), "meta")).toContain(
      "*** Update File: a.ts"
    )
  })
})

describe("highlight — plain / unknown", () => {
  it("returns a single plain token for plain languages", () => {
    const toks = highlight("just text", "text")
    expect(toks).toEqual([{ kind: "plain", value: "just text" }])
  })

  it("best-effort highlights an unknown language (strings/numbers/comments)", () => {
    const toks = highlight('val = "hi" # 7', "rust")
    expect(of(toks, "string")).toContain('"hi"')
    expect(of(toks, "comment")).toContain("# 7")
  })
})

describe("HL_TOKEN_CLASS", () => {
  it("maps every non-plain kind emitted to a class string", () => {
    const src = 'const n = 1 // c\nfoo()\n"s"\ntrue\n$V\n[server]' /* mixed — smoke */
    for (const lang of ["ts", "bash", "toml", "json"]) {
      for (const tok of highlight(src, lang)) {
        if (tok.kind !== "plain") expect(typeof HL_TOKEN_CLASS[tok.kind]).toBe("string")
      }
    }
  })
})

/**
 * Malformed and truncated input. A syntax highlighter runs over whatever a
 * transcript happens to contain, including code that was cut off mid-token, so
 * every scanner has to terminate at end-of-input rather than run away — and it
 * still must not drop a character.
 */
describe("highlight — unterminated and malformed input", () => {
  const lossless = (src: string, lang: string) => expect(text(highlight(src, lang))).toBe(src)

  it("stops an unterminated block comment at end of input", () => {
    const src = "const a = 1\n/* never closed"
    expect(of(highlight(src, "ts"), "comment")).toEqual(["/* never closed"])
    lossless(src, "ts")
  })

  it("ends a line comment that runs to end of input", () => {
    lossless("x = 1 // trailing", "ts")
    expect(of(highlight("x // trailing", "ts"), "comment")).toEqual(["// trailing"])
  })

  it("ends an unterminated single-quoted string at the newline, not the file end", () => {
    const toks = highlight("a = 'oops\nb = 2", "ts")
    expect(of(toks, "string")).toEqual(["'oops"])
    lossless("a = 'oops\nb = 2", "ts")
  })

  it("lets a template literal span lines but still terminates", () => {
    lossless("const t = `line one\nline two", "ts")
  })

  it("stops an unterminated triple-quoted docstring at end of input", () => {
    lossless('def f():\n    """never closed', "python")
  })

  it("stops an unterminated ${} shell expansion at end of input", () => {
    lossless('echo "${UNCLOSED', "bash")
  })

  it("stops an unterminated TOML table header at end of input", () => {
    lossless("[server", "toml")
  })
})

describe("highlight — numeric literals", () => {
  const nums = (src: string) => of(highlight(src, "ts"), "number")

  it("reads hex, octal and binary radix prefixes", () => {
    expect(nums("0xFF_ff + 0o755 + 0b1010")).toEqual(["0xFF_ff", "0o755", "0b1010"])
  })

  it("reads fractions, separators and signed exponents", () => {
    expect(nums("1_000.500 + 1e10 + 2.5e-3 + 3E+8")).toEqual([
      "1_000.500",
      "1e10",
      "2.5e-3",
      "3E+8",
    ])
  })

  it("reads a leading-dot fraction", () => {
    expect(nums("x = .5")).toEqual([".5"])
  })

  it("does not swallow a trailing e that is not an exponent", () => {
    // `1e` has no digits after the `e`, so the identifier must stay separate.
    expect(text(highlight("1e", "ts"))).toBe("1e")
  })
})

describe("highlight — shell variables", () => {
  it("tags braced, named, positional and special forms", () => {
    // Unquoted: inside double quotes the string scanner owns the whole span.
    const vars = of(highlight("echo ${HOME} $USER $1 $? $@", "bash"), "variable")
    expect(vars).toEqual(["${HOME}", "$USER", "$1", "$?", "$@"])
  })

  it("leaves an expansion inside a double-quoted string to the string token", () => {
    const toks = highlight('echo "${HOME}"', "bash")
    expect(of(toks, "string")).toEqual(['"${HOME}"'])
    expect(of(toks, "variable")).toEqual([])
  })

  it("leaves a bare dollar that names nothing", () => {
    expect(text(highlight("echo $ end", "bash"))).toBe("echo $ end")
  })
})

describe("highlight — TOML tables", () => {
  it("tags both a table and an array-of-tables header", () => {
    expect(of(highlight("[server]\n[[items]]\nx = 1", "toml"), "keyword")).toEqual([
      "[server]",
      "[[items]]",
    ])
  })
})
