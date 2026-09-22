/**
 * シート 8 枚の構成。
 *
 * docs/tech-requirements.md 2「実行形態と前提」の「何で動かすか」が決めた
 * 「条件の入力・回答・割り当て・検証結果が同じ 1 ファイルの中のシートとして並ぶ」の実体である。
 * 列の中身は 5-1「入力の型」と 5-4「『違反』と『未充足』は別に数える」から降ろした。
 *
 * 割り当ては 1 枚ではなく、日ごとの 4 枚である（→ dayLabels ／ issue #213）。
 * 4 枚は従来のシフト表の形である ◎ — 行が人、列が 30 分枠、セルが役割名 1 つ。
 * 1 枚に縦積みにしない。配る単位も読む単位も日である ◎（設問も日ごと 4 つ → 4-1）。
 *
 * ここは値を持たない定義だけである。SpreadsheetApp を 1 度も掴まない（→ 6 の #8）。
 * 入力の初期値も持たない — テンプレートが空であること自体が
 * 「前年の値を既定にしない ◎」（5-1 の #1）を満たしている（→ 6 の #1 の却下側）。
 */

/** 生成シートの保護にかける説明文。保護の強さについては src/README.md を読む。 */
const protectionNote = 'スクリプトが書くシートである（手で書き換えない）'

/**
 * 日ごとの 4 枚の名前 ＝ 希望時間 4 設問のラベル ◎（→ 4-1）。定義はここ 1 か所である。
 * フォームの側もここを見る（→ form-definition.js の wishTimeLabels）。
 * 同じ値を 2 か所に書かせない — 食い違ったときに、どちらが正かが決まらない。
 *
 * 上から順に、条件入力の「日ごとの営業時刻」の 4 行と 1 対 1 で当てる。
 * 学祭は例年この 4 日である ◎（2026-09-21 → docs/interviews/02-作る側.md）。
 */
const dayLabels = ['準備日', '学祭1日目', '学祭2日目', '片付け']

/** 割り当てという名前。シートの名前ではなく、コアが受け渡す束の名前である（→ assignmentColumns）。 */
const assignmentName = '割り当て'

/**
 * 割り当ての 1 件の形。これはシートの列ではない — 割り当てが載るのは日ごとの 4 枚のマス目である。
 * コアが受け渡すのはこの形の行で、マス目に敷く／マス目から戻すのは assignment-grid.js が持つ。
 */
const assignmentColumns = ['日', '開始', '終了', '役割', '学籍番号', '氏名']

/**
 * マス目のシートが取る、時刻の列の数。1 日は 30 分枠が最大 48 である（24 時間 ÷ 30 分）。
 * 実際に使うのはその日の枠の数だけで、右の残りは空のまま置く
 * — 枠の数は条件入力の「日ごとの営業時刻」から出る（→ 規則 1 の ①）ので、
 * テンプレートを作る時点では決まっていない（→ build-template.js）。
 */
const maxSlotsPerDay = 48

/**
 * 割り当ての 1 日ぶんのシート。4 枚とも同じ形で、違うのは名前と、何日目かだけである。
 *
 * 従来のシフト表の形である ◎ — 行が人、列がその日の 30 分枠、セルが役割名 1 つ。
 * 1 セル 1 役割にしてあるのは、担当者が書き換えるのが「セルを 1 つ」だからである（→ 5 の #8）。
 *
 * 関数にしてあるのは、4 枚を同じ場所で決めるためである。呼ぶのは同じファイルの中だけで、
 * 関数の宣言は巻き上がるので、sheetLayout より下に書いてあっても通る。
 */
function gridSheet(dayIndex) {
  return {
    name: dayLabels[dayIndex],
    staffWrites: true,
    protect: false,
    hasSectionHeadings: false,
    frozenRows: 1,
    // 学籍番号と氏名を固定しておかないと、右へ送ったときに誰の行かが読めなくなる。
    frozenColumns: 2,
    // この 4 枚がまとまって「割り当て」1 つになる。dayIndex は
    // 条件入力の「日ごとの営業時刻」の何行目と当てるかである（→ dayLabels）。
    grid: { of: assignmentName, dayIndex: dayIndex },
    sections: [
      {
        heading: null,
        startColumn: 1,
        note: '生成の結果（→ issue #213）。行が人、列がその日の 30 分枠、セルが役割名 1 つである。'
          + '担当者がセルを書き換えるのが仕様である（→ 5-3）ので、保護をかけない。'
          + '時刻の見出しは生成のたびに書き直す — 枠は条件入力の「日ごとの営業時刻」から刻む（→ 規則 1 の ①）',
        columns: ['学籍番号', '氏名'],
        // 右は時刻の列である。名前を持たない — 何時の枠かは毎回の入力で変わる。
        // 当てるのは位置ではなく、見出しに書いてある時刻そのものである
        // （→ assignment-grid.js の fromAssignmentGrid）。
        slotColumns: maxSlotsPerDay,
      },
    ],
  }
}

const sheetLayout = [
  {
    name: '条件入力',
    staffWrites: true,
    protect: false,
    hasSectionHeadings: true,
    frozenRows: 2,
    sections: [
      {
        heading: '日ごとの営業時刻',
        startColumn: 1,
        note: '1 日 1 行。時刻は HH:MM で、早い順に書く。ここから 30 分枠を刻む（→ 5-1 の #1・規則 1 の ①）。'
          + '片付け終了がその日の終わりである（→ ADR tech-requirements-0006）',
        columns: ['日付', '準備開始', '調理開始', '調理終了', '片付け開始', '片付け終了'],
      },
      {
        heading: '役割と必要人数',
        startColumn: 8,
        note: '(日・時間帯・役割名・人数) の行。日を空けた行は全日に、'
          + '時間帯を空けた行はその日の 調理開始〜調理終了 の帯に効く（→ 5-1 の #2）。'
          + '準備・片付けの帯に立てるなら、時間帯を書く',
        columns: ['日', '開始', '終了', '役割名', '人数'],
      },
      {
        heading: '調理責任者の学年',
        startColumn: 14,
        note: '調理責任者の枠に置いてよい学年を 1 行 1 つ（→ 5-1 の #3・規則 4）',
        columns: ['学年'],
      },
      {
        heading: '委員会の指定枠',
        startColumn: 16,
        note: '「役割と必要人数」と同じ形。役割名はそちらに無い名前でもよい。'
          + 'フォーム作成後に来る ◎ ので、来たら行を足す（→ 5-1 の #4・規則 6）',
        columns: ['日', '開始', '終了', '役割名', '人数'],
      },
      {
        heading: '準備・片付けのルール',
        startColumn: 22,
        note: '項目に「午前と午後の境目」と書き、値を HH:MM で書く（→ 5-1 の #5・規則 3）。'
          + '「複数日で偏らせない」の線は決まっていない（→ 9 の △ 5）',
        columns: ['項目', '値'],
      },
      {
        heading: '置き方のルール',
        startColumn: 25,
        note: '項目に「連続して入る最小の長さ」と書き、値を 30 分の倍数で書く（1:00 ／ 1:30 ／ 2:00 → 5-1 の #7・5-5）。'
          + '空のままなら 1 時間で走る。枠の刻み（30 分）は動かない — 動くのは置くときのまとまりだけである',
        columns: ['項目', '値'],
      },
    ],
  },
  {
    name: '回答',
    staffWrites: false,
    protect: true,
    hasSectionHeadings: false,
    frozenRows: 1,
    sections: [
      {
        heading: null,
        startColumn: 1,
        note: 'フォームの回答が入る。列は 4-1 の設問 9 つ ＋ タイムスタンプの転記である。'
          + '後ろ 4 列の列名は毎年変わる（設問の題そのものだからである → 4-1）。'
          + '回答先をこのシートに向けるのは issue #144',
        columns: [
          'タイムスタンプ',
          '学籍番号',
          '氏名',
          '学年',
          '調理担当ですか？',
          '一緒に組みたいお友達',
        ],
        // 後ろ 4 列は希望時間 4 設問である。列名は設問の題そのもので、題の日付は今年の入力から出る
        // （→ 4-1）ので、毎年変わる。だから構成は名前を持たない。
        // 持つのは「タイムスタンプ ＋ 設問 9 つ」という並びだけで、突き合わせも取り込みも位置で当てる
        // （→ verify-structure.js の checkSections ／ input-types.js の dayAnswerColumns ／
        //   build-form.js の linkAnswerSheet）。
        yearlyColumns: 4,
      },
    ],
  },
  // 割り当ての 4 枚。同じ形なので、ラベルの位置から組む（→ dayLabels ／ gridSheet ／ issue #213）。
  gridSheet(0),
  gridSheet(1),
  gridSheet(2),
  gridSheet(3),
  {
    name: '検証結果',
    staffWrites: false,
    protect: true,
    hasSectionHeadings: false,
    frozenRows: 1,
    sections: [
      {
        heading: null,
        startColumn: 1,
        note: '違反（置いた人が条件を破っている）と未充足（人数が足りない）を、種別で分けて並べる（→ 5-4）',
        columns: ['種別', '日', '開始', '終了', '役割', '学籍番号', '氏名', '内容', 'あと何人'],
      },
    ],
  },
  {
    name: '指標',
    staffWrites: false,
    protect: true,
    hasSectionHeadings: false,
    frozenRows: 1,
    sections: [
      {
        heading: null,
        startColumn: 1,
        note: '人ごとに 3 つ並べるだけである。順位付けも閾値も出さない（→ 5 の #7・上流の △ 5）',
        columns: ['学籍番号', '氏名', '合計時間', 'シフト回数', '準備回数'],
      },
    ],
  },
]

/** 検証結果シートの「種別」に入る 2 つ（→ 5-4）。値がそのままシートに書かれる。 */
const checkKind = { violation: '違反', unmet: '未充足' }

/**
 * 区画の幅 — 名前のある列 ＋ 毎年名前が変わる列である（後者を持つのは「回答」だけである）。
 * 読む幅も、突き合わせる幅も、列数を見る所も、列名の数ではなくこれを使う
 * （→ shell.js の readSection ／ verify-structure.js の sectionRightEdge ／ input-types.js の checkRowWidth）。
 */
function sectionWidth(section) {
  return section.columns.length + (section.yearlyColumns || 0) + (section.slotColumns || 0)
}

/** 列数が構成と違うことを名指しする文。名前のある列は名前で、そうでない列は数で出す。 */
function sectionColumnsText(section) {
  return section.columns.join(' / ')
    + (section.yearlyColumns ? ` ＋ 毎年名前が変わる ${section.yearlyColumns} 列` : '')
    + (section.slotColumns ? ` ＋ 時刻の ${section.slotColumns} 列` : '')
}

/**
 * 区画の右端の列。そのシートが要る列数である（名前を持たない列も数に入る → sectionWidth）。
 * テンプレートを広げる側（→ build-template.js の widenTo）と、
 * 走る前に列数を照らす側（→ verify-structure.js の checkColumnCount）が、同じここを見る。
 */
function sectionRightEdge(layout) {
  return layout.sections.reduce((rightEdge, section) => Math.max(rightEdge, section.startColumn + sectionWidth(section) - 1), 0)
}

/**
 * 生成が返す行の形。シート 1 枚にそのまま載るものはその列名で、
 * 日ごとの 4 枚にマス目で載る「割り当て」だけは行の形のほうである（→ assignmentColumns）。
 */
function outputColumns(name) {
  if (name === assignmentName) return assignmentColumns
  const layout = sheetLayout.filter((c) => c.name === name)[0]
  if (!layout) throw new Error(`シートの構成に「${name}」が無い`)
  return layout.sections[0].columns
}

/**
 * 割り当ての「区画」— シート 1 枚に対応しないので、行の形から組む（→ assignmentColumns）。
 * 読む側（→ count-violations.js の readAssignments）が、他のシートと同じ手で列を引けるようにしてある。
 */
function assignmentSection() {
  return { heading: null, startColumn: 1, columns: assignmentColumns }
}

/** マス目のシート 4 枚を、dayIndex の順に引く（→ grid）。 */
function gridLayouts(of) {
  return sheetLayout
    .filter((layout) => layout.grid && layout.grid.of === of)
    .sort((a, b) => a.grid.dayIndex - b.grid.dayIndex)
}

// Node から読むためだけの口。Apps Script では module が無いので通らない。
if (typeof module !== 'undefined') {
  module.exports = {
    sheetLayout, checkKind, protectionNote, sectionWidth, sectionColumnsText, sectionRightEdge,
    dayLabels, assignmentName, assignmentColumns, maxSlotsPerDay, outputColumns, assignmentSection, gridLayouts,
  }
}
