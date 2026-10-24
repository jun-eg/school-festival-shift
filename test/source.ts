// ソースの文字列を読む検査の道具 — コメントと文字列の中身を抜いて、コードに出てくる識別子だけを見る。
//
// 正規表現のリテラルと、テンプレートリテラルの ${ } の中だけは、字句を追って判る。それ以外の文法は見ない。
// 見たい名前（SpreadsheetApp など）がコメントや文言に出てきても、コードの参照とは数えないための道具である。

/** コメントと、文字列・正規表現の中身を空にした文字列。テンプレートの ${ } の中は残す。 */
export function stripNoise(source: string): string {
  let out = ''
  let i = 0
  const n = source.length

  function quoted(quote: string) {
    i++
    out += quote
    while (i < n && source[i] !== quote) {
      if (source[i] === '\\') i++
      i++
    }
    i++
    out += quote
  }

  function template() {
    out += '`'
    while (i < n) {
      const c = source[i]
      if (c === '\\') { i += 2; continue }
      if (c === '`') { out += '`'; i++; return }
      if (c === '$' && source[i + 1] === '{') {
        i += 2
        out += ' '
        let depth = 1
        while (i < n && depth > 0) {
          const d = source[i]
          if (d === '{') { depth++; out += d; i++ }
          else if (d === '}') { depth--; i++; if (depth > 0) out += d }
          else if (d === "'" || d === '"') quoted(d)
          else if (d === '`') { i++; template() }
          else { out += d; i++ }
        }
        out += ' '
        continue
      }
      i++
    }
  }

  while (i < n) {
    const c = source[i]
    if (c === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i++
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      i = source.indexOf('*/', i + 2) + 2
      out += ' '
      continue
    }
    if (c === "'" || c === '"') { quoted(c); continue }
    if (c === '`') { i++; template(); continue }
    if (c === '/') {
      // 割り算か正規表現か。直前の字で決める。
      const before = out.trimEnd()
      const prev = before[before.length - 1]
      const word = /(\w+)$/.exec(before)?.[1]
      if (!prev || '(,=:[!&|?{};+-*%<>~^'.includes(prev) || word === 'return' || word === 'typeof') {
        i++
        let inClass = false
        while (i < n) {
          if (source[i] === '\\') { i += 2; continue }
          if (source[i] === '[') inClass = true
          else if (source[i] === ']') inClass = false
          else if (source[i] === '/' && !inClass) break
          i++
        }
        i++
        while (/[a-z]/.test(source[i] || '')) i++
        out += '/r/'
        continue
      }
    }
    out += c
    i++
  }
  return out
}

/** コードに出てくる識別子（. の後ろのプロパティ名は除く）。 */
export function identifiersIn(source: string): Set<string> {
  return new Set([...stripNoise(source).matchAll(/(?<![\w$.])[A-Za-z_$][\w$]*/g)].map((match) => match[0]))
}

/**
 * import ／ export … from ／ import() の行き先。文字列の中身を見るので、コメントは外してから読む。
 * 文字列を抜く前の、コメントだけを除いた文字列から拾う。
 */
export function importSpecifiersIn(source: string): string[] {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  const specifiers: string[] = []
  for (const match of noComments.matchAll(/^\s*(?:import|export)\b[^'"`;]*?\bfrom\s*(['"])([^'"]+)\1/gm)) specifiers.push(match[2])
  for (const match of noComments.matchAll(/^\s*import\s*(['"])([^'"]+)\1/gm)) specifiers.push(match[2])
  for (const match of noComments.matchAll(/\bimport\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g)) specifiers.push(match[2])
  return specifiers
}
