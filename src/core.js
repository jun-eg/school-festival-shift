/**
 * コア — 配列を受けて配列を返す純粋な関数の置き場（docs/tech-requirements.md 6 の #8）。
 *
 * SpreadsheetApp を掴まない。掴むと、生成をブラウザ側に移す逃げ道（→ 6-1 の #2）が消える。
 * 読み書きと値の表現を揃えるのは shell.js で、ここには文字列と数値だけの行が来る（→ checkRepresentation）。
 * 行は入口で 5-1 の型に直してから段へ渡す（→ takeConditions）。
 * 中身の入っていない段は空の配列を返し、「まだ作っていない」を名指しで持ち帰る。
 *
 * 他のファイルの値を最上位で使わない。Apps Script は .gs を順に評価するので、並び順で壊れる。
 */

/**
 * コアの段と、中身を入れる issue（→ 8「作業の順序」）。並びは build が呼ぶ順である。
 * writesTo は段が行を出す生成シート（出さない段は null）。name は steps のキーと突き合わせる。
 */
const coreSteps = [
  { name: '取り込む', issue: 146, writesTo: null, whatItDoes: '回答の行を 1 人 1 件に畳む（規則 2 ／ 8 の 6）' },
  { name: '展開する', issue: 149, writesTo: null, whatItDoes: '回答文字列をその人の 30 分枠の集合にする（規則 1 ／ 8 の 7）' },
  { name: '固定を照らす', issue: 156, writesTo: '検証結果', whatItDoes: '手直しのうち、いまの入力で置けないものを行にする（5-3 ／ 8 の 11）' },
  { name: '生成する', issue: 151, writesTo: '割り当て', whatItDoes: '候補・条件・希望から割り当ての行を組む（5 の #6 ／ 8 の 8）' },
  { name: '違反を数える', issue: 141, writesTo: '検証結果', whatItDoes: '置いた人が条件を破っている所を行にする（5-4 ／ 8 の 3）' },
  { name: '未充足を名指しする', issue: 142, writesTo: '検証結果', whatItDoes: '人数が足りない枠を行にする（5-4 ／ 8 の 3）' },
  { name: '指標を出す', issue: 154, writesTo: '指標', whatItDoes: '人ごとの合計時間・シフト回数・準備回数を行にする（5 の #7 ／ 8 の 9）' },
]

/**
 * 中身が入っている段。渡された steps が同じ名前を持っていれば、そちらが勝つ（→ build）。
 * 段を入れたらここに 1 行足す。関数の中で見るのは、ファイルを貼る順に依存しないためである。
 */
function builtInSteps() {
  // 手で貼るので貼り忘れがある。入っている段を「まだ作っていない」に混ぜず、名指しして止まる。
  if (typeof takeIn !== 'function') {
    throw internalError('take-in.js が貼られていない')
  }
  if (typeof expand !== 'function') {
    throw internalError('expand.js が貼られていない')
  }
  if (typeof generate !== 'function') {
    throw internalError('generate.js が貼られていない')
  }
  if (typeof nameFixedConflicts !== 'function') {
    throw internalError('generate.js が古い。貼り直す')
  }
  if (typeof countViolations !== 'function') {
    throw internalError('count-violations.js が貼られていない')
  }
  if (typeof nameUnmet !== 'function') {
    throw internalError('name-unmet.js が貼られていない')
  }
  if (typeof fairnessMetrics !== 'function') {
    throw internalError('fairness-metrics.js が貼られていない')
  }
  return {
    '取り込む': takeIn,
    '展開する': expand,
    '固定を照らす': nameFixedConflicts,
    '生成する': generate,
    '違反を数える': countViolations,
    '未充足を名指しする': nameUnmet,
    '指標を出す': fairnessMetrics,
  }
}

/**
 * コアが返す束（→ 5-4・5 の #7）。どこに敷くかは殻が決める（→ shell.js の writeOutputs）。
 * 「割り当て」だけはシート 1 枚でなく、日ごとの 4 枚にマス目で載る。
 */
const outputNames = ['割り当て', '検証結果', '指標']

/** コアが読まないシート。生成しか書かないので入力にならない。 */
const sheetsNotRead = ['検証結果', '指標']

/**
 * コアが受け取る入力の名前。値はどれも行の配列である。
 * 条件入力は区画ごと、回答はシート 1 枚で 1 つ。マス目の 4 枚からは
 * 割り当て（数え直しが読む）と手直し（担当者が書き換えたセル。生成が固定として置く → 5-3）の 2 つが出る。
 * 名前は sheet-layout.js から引く。
 */
function inputNames() {
  const names = []
  sheetLayout.forEach((layout) => {
    if (sheetsNotRead.indexOf(layout.name) !== -1) return
    // マス目の 4 枚は、まとまって 2 つの入力になる。
    if (layout.grid) {
      ;[layout.grid.of, layout.grid.fixed].forEach((name) => { if (names.indexOf(name) === -1) names.push(name) })
      return
    }
    layout.sections.forEach((section) => names.push(layout.hasSectionHeadings ? section.heading : layout.name))
  })
  return names
}

/** 条件入力の 6 区画の名前。段に渡るのはここから直した型のほうである（→ takeConditions）。 */
function conditionNames() {
  return sheetLayout
    .filter((layout) => layout.name === '条件入力')[0]
    .sections.map((section) => section.heading)
}

/**
 * 入力の行から、生成シート 3 枚の行を組む。
 *
 * steps は段の名前から関数への対応で、builtInSteps を差し替える。どちらにも無い段は「まだ作っていない」になる。
 * 差し替えられるのは、数える側を生成より先に回すためである（→ 8 の 3）。
 *
 * 返すもの: { 割り当て, 検証結果, 指標, notBuilt }。notBuilt は中身の入っていない段で、見せ方は殻が決める。
 */
function build(inputs, steps) {
  checkRepresentation(inputs)
  const stepsToCall = builtInSteps()
  Object.keys(steps || {}).forEach((name) => { stepsToCall[name] = steps[name] })
  const notBuilt = []

  function callStep(name, args) {
    if (typeof stepsToCall[name] !== 'function') {
      notBuilt.push(findStep(name))
      return []
    }
    return stepsToCall[name].apply(null, args)
  }

  const conditions = takeConditions(inputs)

  // 取り込み（規則 2）を通った型 #6 だけが下流へ行く。友達欄も氏名も乗らない（→ 5-2）。
  const wishes = callStep('取り込む', [inputs['回答']])
  const candidates = callStep('展開する', [wishes, conditions.days])

  // 固定は担当者が書き換えたセルだけである（→ 5-3）。前の周に機械が置いた「割り当て」は渡さない。
  // 置けない固定は、ここで名指しされる（→ generate.js の nameFixedConflicts）。
  const fixed = inputs[fixedName]
  const fixConflicts = callStep('固定を照らす', [fixed, candidates, conditions, wishes])

  // 規則 4 の学年と規則 5 の調理可否は候補に乗っていないので、生成にも希望を渡す。
  const assignments = callStep('生成する', [candidates, conditions, wishes, fixed])

  // 違反と未充足は別に数えて、同じ 1 枚に種別で並べる（→ 5-4）。
  // 規則 1 の違反は展開した枠と照らさないと見えないので、候補も渡す。
  const violations = callStep('違反を数える', [assignments, conditions, wishes, candidates])
  const unmet = callStep('未充足を名指しする', [assignments, conditions])
  // 1 枠も置かれなかった人も 0 で並べるため、指標にも希望を渡す。
  const metrics = callStep('指標を出す', [assignments, conditions, wishes])

  // 食い違った固定を先頭に置く。未充足は何十行も並ぶので、後ろだと目に入らない。
  const checks = withCandidates(fixConflicts.concat(violations, unmet), candidates)
  const output = { '割り当て': assignments, '検証結果': checks, '指標': metrics }
  checkOutput(output)
  output.notBuilt = notBuilt
  return output
}

/**
 * 手直しの後に、違反と未充足と指標を数え直す（→ 5 の #8 ／ issue #155）。
 *
 * 生成を走らせず、マス目に書いてあるとおりを数える（→ keepAsPlaced）。走らせると 1 セル直すたびに
 * 残りが組み直され、その 1 手で何が変わったかが見えなくなる。数える段は build と同じものを通す。
 * 固定は照らさない（→ noFixedToCheck）。照らすと、同じ 1 セルが違反と食い違った固定の 2 行で出る。
 */
function recount(inputs) {
  return build(inputs, { '固定を照らす': noFixedToCheck, '生成する': keepAsPlaced(inputs[assignmentName]) })
}

/** 「生成する」の段の代わり。マス目に書いてあるとおり（placed）を、1 枠も足さず外さず返す。 */
function keepAsPlaced(placed) {
  return function () { return placed }
}

/** 「固定を照らす」の段の代わり。数え直しでは照らさない（→ recount の注意）。 */
function noFixedToCheck() {
  return []
}

/**
 * 検証結果の行ごとに、その 30 分枠を希望に含む人（→ 展開する）を「候補」に入れる（→ issue #246）。
 *
 * コアは氏名を見ない（→ 5 の #1）ので、入れるのは学籍番号で、氏名に置き換えるのは殻である（→ shell.js の withNamesFromAnswers）。
 * 並びは展開が返した順（＝ 取り込みが返した順）である。置いてあるか、ほかの規則に合うかは見ない —
 * 見るのは希望の時間だけで、誰を置くかは担当者が決める（→ 5-3）。
 * 枠が 1 つに決まらない行（開始か終了が空 — 規則 3 の違反・いまの枠に無い手直し）は空のままにする。
 */
function withCandidates(rows, candidates) {
  const columns = sheetColumns('検証結果')
  const at = (name) => columns.indexOf(name)
  const wishedBy = {}
  ;(candidates || []).forEach((candidate) => {
    ;(candidate.slots || []).forEach((slot) => {
      const key = `${candidate.date} ${slot.start}-${slot.end}`
      if (!wishedBy[key]) wishedBy[key] = []
      if (wishedBy[key].indexOf(candidate.studentId) === -1) wishedBy[key].push(candidate.studentId)
    })
  })

  return rows.map((row) => {
    const filled = row.slice()
    const date = row[at('日')]
    const start = row[at('開始')]
    const end = row[at('終了')]
    const wished = date === '' || start === '' || end === '' ? [] : wishedBy[`${date} ${start}-${end}`] || []
    filled[at('候補')] = wished.join(candidateSeparator)
    return filled
  })
}

/** 条件入力の 6 区画を 5-1 の型に直す（→ input-types.js）。キーは型の側の名前である。 */
function takeConditions(inputs) {
  const conditions = {}
  conditionTypes().forEach((type) => { conditions[type.key] = toType(type, inputs[type.source]) })
  return conditions
}

/** 段の名前から coreSteps の 1 行を引く。名前が表に無ければ、そこで止まる。 */
function findStep(name) {
  const step = coreSteps.filter((row) => row.name === name)[0]
  if (!step) throw internalError(`コアの段に「${name}」が無い（coreSteps と build が食い違っている）`)
  return { name: step.name, issue: step.issue, writesTo: step.writesTo, whatItDoes: step.whatItDoes }
}

/**
 * 殻が値の表現を揃えたかを、コアの入口で確かめる。見るのは「文字列か数値か」だけである。
 * 揺れたまま入ってきたら、黙って直さずに名指しで止まる（→ 6 の #8）。
 */
function checkRepresentation(inputs) {
  if (!inputs || typeof inputs !== 'object') throw internalError('入力が、名前と行の配列の対応になっていない')

  const names = inputNames()
  names.forEach((name) => {
    if (!Array.isArray(inputs[name])) throw internalError(`入力に「${name}」の行の配列が無い`)
  })
  Object.keys(inputs).forEach((name) => {
    if (names.indexOf(name) === -1) throw internalError(`入力の名前に無い「${name}」が渡っている`)
  })

  names.forEach((name) => {
    inputs[name].forEach((row, rowIndex) => {
      if (!Array.isArray(row)) throw internalError(`「${name}」の ${rowIndex + 1} 行目が配列でない`)
      row.forEach((cell, columnIndex) => {
        const type = typeof cell
        if (type === 'string' || type === 'number') return
        throw internalError(
          `「${name}」の ${rowIndex + 1} 行目 ${columnIndex + 1} 列目の表現が揃っていない。`
            + `いま: ${type === 'object' ? Object.prototype.toString.call(cell) : type}（殻で文字列か数値に揃える）`,
        )
      })
    })
  })
}

/** 段が返した行が、書き込む先のシートの形に合っているかを確かめる。黙って詰めない。 */
function checkOutput(output) {
  outputNames.forEach((name) => {
    const columns = sheetColumns(name)
    output[name].forEach((row, rowIndex) => {
      if (Array.isArray(row) && row.length === columns.length) return
      throw internalError(
        `「${name}」に返された ${rowIndex + 1} 行目の列数が構成と違う。`
          + `いま: ${Array.isArray(row) ? row.length : '配列でない'} ／ 構成: ${columns.length}（${columns.join(' / ')}）`,
      )
    })
  })

  const kindColumn = sheetColumns('検証結果').indexOf('種別')
  const allowedKinds = Object.keys(checkKind).map((key) => checkKind[key])
  output['検証結果'].forEach((row, rowIndex) => {
    if (allowedKinds.indexOf(row[kindColumn]) !== -1) return
    throw internalError(
      `検証結果の ${rowIndex + 1} 行目の種別「${row[kindColumn]}」が決まった種別でない（${allowedKinds.join(' ／ ')} のどれか）`,
    )
  })
}

/** 生成シートの区画を 1 つ引く。「割り当て」はシートに対応しないので、行の形から組む。 */
function sheetSection(name) {
  if (name === assignmentName) return assignmentSection()
  const layout = sheetLayout.filter((c) => c.name === name)[0]
  if (!layout) throw internalError(`シートの構成に「${name}」が無い`)
  return layout.sections[0]
}

/** 生成が返す行の列名を引く（→ sheet-layout.js の outputColumns）。 */
function sheetColumns(name) {
  return outputColumns(name)
}

// Node から読むためだけの口。Apps Script では module が無いので通らない。
if (typeof module !== 'undefined') {
  module.exports = {
    coreSteps, outputNames, sheetsNotRead, inputNames, conditionNames, builtInSteps,
    build, recount, keepAsPlaced, noFixedToCheck, withCandidates, takeConditions, findStep, checkRepresentation, checkOutput, sheetSection, sheetColumns,
  }
}
