/**
 * コア — 配列を受けて配列を返す純粋な関数の置き場（docs/tech-requirements.md 6 の #8）。
 *
 * SpreadsheetApp を 1 度も掴まない。掴んだ瞬間に、6-1 の #2 に書いてある逃げ道
 * （実行時間の上限に当たったら生成をブラウザ側に移す。方式は変えない）が、書き方のせいで消える
 * — ダイアログの中に SpreadsheetApp は無い。
 *
 * 読み書きと、値の表現を揃えるのは shell.js の仕事である。
 * ここに入ってくるのは、文字列と数値だけでできた行の配列である（→ checkRepresentation）。
 * 揺れを殻に閉じ込めないと、決定性がコアの外で崩れる（→ 6 の #8 の理由 ③）。
 *
 * 行のまま段へ渡さない。入口で 5-1 の型に直してから渡す（→ input-types.js ／ takeConditions）。
 * 段が受け取るのは型であって、シートの列の並びではない。
 *
 * 段の中身は、それぞれの issue が入れる（→ coreSteps）。入っている段は builtInSteps が持つ。
 * 入っていない段は空の配列を返し、「まだ作っていない」を名指しで持ち帰る。黙って走らない。
 * ここに判断を新しく書かない（→ src/README.md）。
 *
 * 他のファイルの値をこのファイルの最上位で使わない。Apps Script は .gs を 1 つずつ順に評価するので、
 * 並び順で壊れる。sheet-layout.js を見るのは関数の中だけにしてある。
 */

/**
 * コアの段と、それぞれの中身を入れる issue（docs/tech-requirements.md 8「作業の順序」）。
 * 並びは build が呼ぶ順である。writesTo は、その段が行を出す生成シートである（出さない段は null）。
 * name の値は段の名前で、steps のキーと突き合わせる文字列である（→ build）。
 */
const coreSteps = [
  { name: '取り込む', issue: 146, writesTo: null, whatItDoes: '回答の行を 1 人 1 件に畳む（規則 2 ／ 8 の 6）' },
  { name: '展開する', issue: 149, writesTo: null, whatItDoes: '回答文字列をその人の 30 分枠の集合にする（規則 1 ／ 8 の 7）' },
  { name: '生成する', issue: 151, writesTo: '割り当て', whatItDoes: '候補・条件・固定から割り当ての行を組む（5 の #6 ／ 8 の 8）' },
  { name: '違反を数える', issue: 141, writesTo: '検証結果', whatItDoes: '置いた人が条件を破っている所を行にする（5-4 ／ 8 の 3）' },
  { name: '未充足を名指しする', issue: 142, writesTo: '検証結果', whatItDoes: '人数が足りない枠を行にする（5-4 ／ 8 の 3）' },
  { name: '指標を出す', issue: 154, writesTo: '指標', whatItDoes: '人ごとの合計時間・シフト回数・準備回数を行にする（5 の #7 ／ 8 の 9）' },
]

/**
 * 中身が入っている段。渡された steps が同じ名前を持っていれば、そちらが勝つ
 * （段を差し替えて先に回せる形は動かさない → build）。
 *
 * ここに名前が無い段は「まだ作っていない」である。入れたら 1 行足す
 * — 入っているのに未了として名指しすると、notBuilt が嘘になる。
 * 関数の中で見ているのは、ファイルを貼る順に依存しないためである（→ 先頭の注意）。
 */
function builtInSteps() {
  // 手で貼る形なので、1 ファイル貼り忘れることがある（→ src/README.md の「clasp を本筋にしない」）。
  // 貼られていなければ名指しして止まる。入っている段を「まだ作っていない」に混ぜない。
  if (typeof countViolations !== 'function') {
    throw new Error('count-violations.js が貼られていない（「違反を数える」の中身がそこにある → issue #141）')
  }
  return { '違反を数える': countViolations }
}

/** コアが返すシート。生成が書く 3 枚である（→ 5 の #6・#7・5-4）。 */
const outputNames = ['割り当て', '検証結果', '指標']

/** コアが読まないシート。生成しか書かないので、入力にならない（→ 5-4・5 の #7）。 */
const sheetsNotRead = ['検証結果', '指標']

/**
 * コアが受け取る入力の名前。値はどれも「行の配列」である。
 * 条件入力は区画ごと（5-1 の #1〜#5）、回答と割り当てはシートごとに 1 つ。
 * 割り当てが入っているのは、前の周の手直しを固定として積み直すためである（→ 5-3）。
 * 名前は sheet-layout.js から引く — 文字列を二重に持つと、片方が古くなる。
 */
function inputNames() {
  const names = []
  sheetLayout.forEach((layout) => {
    if (sheetsNotRead.indexOf(layout.name) !== -1) return
    layout.sections.forEach((section) => names.push(layout.hasSectionHeadings ? section.heading : layout.name))
  })
  return names
}

/**
 * 条件入力の 5 区画の名前（→ 5-1 の #1〜#5）。殻が読む単位であり、入力の名前の一部である。
 * 段に渡るのはこの名前ではなく、ここから直した型のほうである（→ takeConditions）。
 */
function conditionNames() {
  return sheetLayout
    .filter((layout) => layout.name === '条件入力')[0]
    .sections.map((section) => section.heading)
}

/**
 * 入力の行から、生成シート 3 枚の行を組む。
 *
 * steps は段の名前から関数への対応である（中身が入っていて渡さなかった段は builtInSteps が、
 * どちらにも無い段は「まだ作っていない」になる）。
 * 差し替えで渡せる形にしてあるのは、8 の 3 が 8 の 8 より先にあるからである
 * — 数える側だけを先に入れて、生成が無いまま回せる。
 *
 * 返すもの: { 割り当て, 検証結果, 指標, notBuilt }。シート 3 枚のキーは、シート名そのものである。
 * notBuilt は中身の入っていない段の名指しである。どう見せるか・どこまで書くかは殻が決める。
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

  // 回答をそのまま先へ流さない。取り込み（規則 2）を通った希望だけが下流へ行く。
  // 取り込むが返すのは型 #6（1 人 1 件）で、友達欄も氏名もそこに乗っていない（→ 5-2・input-types.js）。
  const wishes = callStep('取り込む', [inputs['回答']])
  const candidates = callStep('展開する', [wishes, conditions.days])

  const fixed = inputs['割り当て'] // 前の周で担当者が書き換えたところ（→ 5-3）
  const assignments = callStep('生成する', [candidates, conditions, fixed])

  // 違反と未充足は別に数えて、同じ 1 枚に種別で分けて並べる（→ 5-4）。
  // 数える側に候補も渡る。規則 1 の違反（希望の時間の外）は、展開した枠と照らさないと見えない。
  const violations = callStep('違反を数える', [assignments, conditions, wishes, candidates])
  const unmet = callStep('未充足を名指しする', [assignments, conditions])
  const metrics = callStep('指標を出す', [assignments])

  const output = { '割り当て': assignments, '検証結果': violations.concat(unmet), '指標': metrics }
  checkOutput(output)
  output.notBuilt = notBuilt
  return output
}

/**
 * 入力から条件入力の 5 区画を取り出し、5-1 の型に直す（→ input-types.js の conditionTypes）。
 * キーは型の側の名前である — 段が掴むのは型であって、区画の見出しではない。
 */
function takeConditions(inputs) {
  const conditions = {}
  conditionTypes().forEach((type) => { conditions[type.key] = toType(type, inputs[type.source]) })
  return conditions
}

/** 段の名前から coreSteps の 1 行を引く。名前が表に無ければ、そこで止まる。 */
function findStep(name) {
  const step = coreSteps.filter((row) => row.name === name)[0]
  if (!step) throw new Error(`コアの段に「${name}」が無い（coreSteps と build が食い違っている）`)
  return { name: step.name, issue: step.issue, writesTo: step.writesTo, whatItDoes: step.whatItDoes }
}

/**
 * 殻が値の表現を揃えたかを、コアの入口で確かめる。
 *
 * 見るのは「文字列か数値か」だけである。日付と時刻の書き方そのものは shell.js が持つ（→ valueRepresentation）。
 * SpreadsheetApp から読んだ値はロケールと書式で表現が揺れる（時刻が Date で来るか文字列で来るか）。
 * 揺れたまま入ってきたら、黙って直さずに名指しで止まる（→ 6 の #8 の理由 ③）。
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
 * 段が返した行が、書き込む先のシートの形に合っているかを確かめる。
 * 合わないまま書くと、担当者の画面で列がずれる。黙って詰めない。
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

/** シート 1 枚の列名を引く。割り当て・検証結果・指標はどれも区画を 1 つしか持たない。 */
function sheetColumns(name) {
  const layout = sheetLayout.filter((c) => c.name === name)[0]
  if (!layout) throw new Error(`シートの構成に「${name}」が無い`)
  return layout.sections[0].columns
}

// Node から読むためだけの口。Apps Script では module が無いので通らない。
if (typeof module !== 'undefined') {
  module.exports = {
    coreSteps, outputNames, sheetsNotRead, inputNames, conditionNames, builtInSteps,
    build, takeConditions, findStep, checkRepresentation, checkOutput, sheetColumns,
  }
}
