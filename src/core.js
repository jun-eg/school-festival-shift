/**
 * The core — where the pure functions live, the ones that take arrays and return arrays
 * (docs/tech-requirements.md 6 の #8).
 *
 * It never touches SpreadsheetApp. The moment it does, the way out written in 6-1 の #2
 * (if we hit the execution time limit, move the generation to the browser side; the method
 * itself does not change) disappears because of how the code is written — there is no
 * SpreadsheetApp inside a dialog.
 *
 * Reading and writing, and lining the value representations up, is shell.js's job.
 * What arrives here is arrays of rows made of strings and numbers only (→ checkRepresentation).
 * Unless the wobble is shut inside the shell, determinism breaks outside the core
 * (→ 6 の #8 の理由 ③).
 *
 * This file is a skeleton. The contents of each step are put in by their own issue (→ coreSteps).
 * A step that is not in yet returns an empty array and carries back a named「まだ作っていない」.
 * It never runs silently. No new judgement gets written here (→ src/README.md).
 *
 * Never use a value from another file at the top level of this file. Apps Script evaluates the
 * .gs files one by one in order, so it breaks on the ordering. sheet-layout.js is only ever
 * looked at from inside a function.
 */

/**
 * The steps of the core, and the issue that puts the contents of each one in
 * (docs/tech-requirements.md 8「作業の順序」).
 * The order is the order build calls them in. writesTo is the generated sheet the step puts
 * rows into (null for a step that puts out none).
 */
const coreSteps = [
  { name: '取り込む', issue: 146, writesTo: null, whatItDoes: '回答の行を 1 人 1 件に畳む（規則 2 ／ 8 の 6）' },
  { name: '展開する', issue: 149, writesTo: null, whatItDoes: '回答文字列をその人の 30 分枠の集合にする（規則 1 ／ 8 の 7）' },
  { name: '生成する', issue: 151, writesTo: '割り当て', whatItDoes: '候補・条件・固定から割り当ての行を組む（5 の #6 ／ 8 の 8）' },
  { name: '違反を数える', issue: 141, writesTo: '検証結果', whatItDoes: '置いた人が条件を破っている所を行にする（5-4 ／ 8 の 3）' },
  { name: '未充足を名指しする', issue: 142, writesTo: '検証結果', whatItDoes: '人数が足りない枠を行にする（5-4 ／ 8 の 3）' },
  { name: '指標を出す', issue: 154, writesTo: '指標', whatItDoes: '人ごとの合計時間・シフト回数・準備回数を行にする（5 の #7 ／ 8 の 9）' },
]

/** The sheets the core returns. These are the 3 that generation writes (→ 5 の #6・#7・5-4). */
const outputNames = ['割り当て', '検証結果', '指標']

/** Sheets the core does not read. Only generation writes them, so they are not inputs (→ 5-4・5 の #7). */
const sheetsNotRead = ['検証結果', '指標']

/**
 * The names of the inputs the core takes. Every value is an「array of rows」.
 * 条件入力 comes in per section (5-1 の #1〜#5); 回答 and 割り当て come in one per sheet.
 * 割り当て is in there so that the hand edits from the previous round can be stacked back in
 * as fixed rows (→ 5-3).
 * The names are pulled from sheet-layout.js — hold a string in two places and one of them goes stale.
 */
function inputNames() {
  const names = []
  sheetLayout.forEach((layout) => {
    if (sheetsNotRead.indexOf(layout.name) !== -1) return
    layout.sections.forEach((section) => names.push(layout.hasSectionHeadings ? section.heading : layout.name))
  })
  return names
}

/** The names of the 5 sections of 条件入力 (→ 5-1 の #1〜#5). This is as far as the generating and counting sides see. */
function conditionNames() {
  return sheetLayout
    .filter((layout) => layout.name === '条件入力')[0]
    .sections.map((section) => section.heading)
}

/**
 * Build the rows of the 3 generated sheets out of the input rows.
 *
 * steps maps a step name to a function (a step that is not passed in becomes「まだ作っていない」).
 * It is passed in this swappable shape because 8 の 3 comes before 8 の 8 — the counting side
 * alone can be put in and run while there is no generation yet.
 *
 * What it returns: { 割り当て, 検証結果, 指標, notBuilt }.
 * notBuilt names the steps whose contents are not in. How to show it, and how far to write,
 * is the shell's call.
 */
function build(inputs, steps) {
  checkRepresentation(inputs)
  const stepsToCall = steps || {}
  const notBuilt = []

  function callStep(name, args) {
    if (typeof stepsToCall[name] !== 'function') {
      notBuilt.push(findStep(name))
      return []
    }
    return stepsToCall[name].apply(null, args)
  }

  // Never let the raw answers flow straight on. Only the wishes that went through the intake
  // (規則 2) go downstream. The friend column not showing up in the input of the generation
  // follows from this shape (→ 5-2).
  const wishes = callStep('取り込む', [inputs['回答']])
  const candidates = callStep('展開する', [wishes, inputs['日ごとの営業 4 時刻']])

  const conditions = takeConditions(inputs)
  const fixed = inputs['割り当て'] // what the staff rewrote in the previous round (→ 5-3)
  const assignments = callStep('生成する', [candidates, conditions, fixed])

  // 違反 and 未充足 are counted separately and laid out on the same one sheet, split by 種別 (→ 5-4).
  const violations = callStep('違反を数える', [assignments, conditions, wishes])
  const unmet = callStep('未充足を名指しする', [assignments, conditions])
  const metrics = callStep('指標を出す', [assignments])

  const output = { '割り当て': assignments, '検証結果': violations.concat(unmet), '指標': metrics }
  checkOutput(output)
  output.notBuilt = notBuilt
  return output
}

/** Take just the 5 sections of 条件入力 out of the inputs (→ 5-1 の #1〜#5). */
function takeConditions(inputs) {
  const conditions = {}
  conditionNames().forEach((name) => { conditions[name] = inputs[name] })
  return conditions
}

/** Look up the one row of coreSteps by step name. If the name is not in the table, it stops right there. */
function findStep(name) {
  const step = coreSteps.filter((row) => row.name === name)[0]
  if (!step) throw new Error(`コアの段に「${name}」が無い（coreSteps と build が食い違っている）`)
  return { name: step.name, issue: step.issue, writesTo: step.writesTo, whatItDoes: step.whatItDoes }
}

/**
 * Check, at the door of the core, that the shell lined the value representations up.
 *
 * All it looks at is「string or number」. How dates and times are written is shell.js's to hold
 * (→ valueRepresentation). Values read from SpreadsheetApp wobble in representation with the
 * locale and the cell format (a time arrives as a Date, or as a string).
 * If one comes in still wobbling, it stops and names it instead of silently fixing it
 * (→ 6 の #8 の理由 ③).
 */
function checkRepresentation(inputs) {
  if (!inputs || typeof inputs !== 'object') throw new Error('入力が、名前と行の配列の対応になっていない')

  const names = inputNames()
  names.forEach((name) => {
    if (!Array.isArray(inputs[name])) throw new Error(`入力に「${name}」の行の配列が無い`)
  })
  Object.keys(inputs).forEach((name) => {
    if (names.indexOf(name) === -1) throw new Error(`入力の名前に無い「${name}」が渡っている`)
  })

  names.forEach((name) => {
    inputs[name].forEach((row, rowIndex) => {
      if (!Array.isArray(row)) throw new Error(`「${name}」の ${rowIndex + 1} 行目が配列でない`)
      row.forEach((cell, columnIndex) => {
        const type = typeof cell
        if (type === 'string' || type === 'number') return
        throw new Error(
          `「${name}」の ${rowIndex + 1} 行目 ${columnIndex + 1} 列目の表現が揃っていない。`
            + `いま: ${type === 'object' ? Object.prototype.toString.call(cell) : type}。`
            + '文字列か数値に揃えるのは殻の仕事である（→ shell.js の normalizeValue）',
        )
      })
    })
  })
}

/**
 * Check that the rows a step returned fit the shape of the sheet they are written into.
 * Write them in without fitting and the columns slide on the staff's screen. Nothing gets
 * silently squeezed in.
 */
function checkOutput(output) {
  outputNames.forEach((name) => {
    const columns = sheetColumns(name)
    output[name].forEach((row, rowIndex) => {
      if (Array.isArray(row) && row.length === columns.length) return
      throw new Error(
        `「${name}」に返された ${rowIndex + 1} 行目の列数が構成と違う。`
          + `いま: ${Array.isArray(row) ? row.length : '配列でない'} ／ 構成: ${columns.length}（${columns.join(' / ')}）`,
      )
    })
  })

  const kindColumn = sheetColumns('検証結果').indexOf('種別')
  const allowedKinds = Object.keys(checkKind).map((key) => checkKind[key])
  output['検証結果'].forEach((row, rowIndex) => {
    if (allowedKinds.indexOf(row[kindColumn]) !== -1) return
    throw new Error(
      `検証結果の ${rowIndex + 1} 行目の種別が「${row[kindColumn]}」である。`
        + `違反と未充足は別に数える（→ 5-4）ので、種別は ${allowedKinds.join(' か ')} のどちらかである`,
    )
  })
}

/** Look up the column names of one sheet. 割り当て, 検証結果 and 指標 each hold only one section. */
function sheetColumns(name) {
  const layout = sheetLayout.filter((c) => c.name === name)[0]
  if (!layout) throw new Error(`シートの構成に「${name}」が無い`)
  return layout.sections[0].columns
}

// A door for Node to read this file through, nothing more. Apps Script has no module, so it never runs there.
if (typeof module !== 'undefined') {
  module.exports = {
    coreSteps, outputNames, sheetsNotRead, inputNames, conditionNames,
    build, takeConditions, findStep, checkRepresentation, checkOutput, sheetColumns,
  }
}
