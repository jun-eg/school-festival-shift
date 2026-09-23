/**
 * 1 ファイルに並ぶシート 8 枚の構成（→ docs/tech-requirements.md 2・5-1・5-4）。
 *
 * 割り当ては日ごとの 4 枚で、従来のシフト表の形（行が人、列が 30 分枠、セルが役割名 1 つ）である（→ issue #213）。
 * 定義だけを持ち、SpreadsheetApp を掴まない。持つ値は条件入力の初期値（→ initialRows）だけで、
 * テンプレートを作るときに入力欄へ置く（→ build-template.js の putInitialRows ／ ADR tech-requirements-0015）。
 */

/**
 * 保護のかけ方 2 つ。値がそのまま組み立ての記録に出る（強さは src/README.md）。
 *   警告のみ   — 持ち主も含めて、書き換えると確認が出る。誰も手で書かないシートにかける。
 *   持ち主だけ — 持ち主（シフト作成者）だけが確認なしで書ける。手直しで書き換えるシートにかける（→ issue #234）。
 */
const protectionKind = { warningOnly: '警告のみ', ownerOnly: '持ち主だけ' }

/** 生成シートの保護にかける説明文。 */
const protectionNote = 'スクリプトが書くシートである（手で書き換えない）'

/** 割り当ての 4 枚の保護にかける説明文。 */
const gridProtectionNote = 'シフト作成者（このファイルの持ち主）だけが書き換えるシートである'

/** 条件入力の保護にかける説明文。保護の外に出すのは区画の入力欄だけである（→ openInputs）。 */
const inputProtectionNote = '見出しと区画のあいだは手で書き換えない（書くのは各区画の列名より下である）'

/**
 * 日ごとの 4 枚の名前 ＝ 希望時間 4 設問のラベル（→ 4-1）。フォームの側もここを見る（→ form-definition.js）。
 * 上から順に、条件入力の「日ごとの営業時刻」の 4 行と 1 対 1 で当てる。
 */
const dayLabels = ['準備日', '学祭1日目', '学祭2日目', '片付け']

/** 割り当てという名前。シート名ではなく、コアが受け渡す束の名前である。 */
const assignmentName = '割り当て'

/** 割り当ての 1 件の形（シートの列ではない）。マス目との行き来は assignment-grid.js が持つ。 */
const assignmentColumns = ['日', '開始', '終了', '役割', '学籍番号', '氏名']

/**
 * 手直しという名前。コアが受け渡す束の名前である（→ 5-3 ／ issue #156）。
 * 担当者が書き換えたセル（印はセルのメモ → assignment-grid.js の fixedNote）だけが乗る。
 */
const fixedName = '手直し'

/**
 * 手直し 1 件の形。終了は持たず、開始はマス目の見出しの時刻である。枠に直すのは generate.js の placeFixed。
 * 役割が空の行は「この人をこの枠に置かない」という手直しである。
 */
const fixedColumns = ['日', '開始', '役割', '学籍番号']

/**
 * マス目のシートが取る時刻の列の数（24 時間 ÷ 30 分）。
 * 枠の数はテンプレートを作る時点では決まらないので、最大を取って右の残りは空にする。
 */
const maxSlotsPerDay = 48

/**
 * 割り当ての 1 日ぶんのシート。4 枚とも同じ形で、違うのは名前と何日目かだけである。
 * 1 セル 1 役割なのは、担当者の手直しを「セルを 1 つ書き換える」にするためである（→ 5 の #8）。
 */
function gridSheet(dayIndex) {
  return {
    name: dayLabels[dayIndex],
    staffWrites: true,
    // 担当者は手直しでセルを書き換える（→ 5-3）ので、持ち主は確認なしで書ける形にする。
    // 共有された編集者は触らない（→ issue #234）。
    protect: { kind: protectionKind.ownerOnly, note: gridProtectionNote },
    hasSectionHeadings: false,
    frozenRows: 1,
    // 学籍番号と氏名を固定しておかないと、右へ送ったときに誰の行かが読めなくなる。
    frozenColumns: 2,
    // 4 枚まとめて「割り当て」1 つになる。dayIndex は「日ごとの営業時刻」の何行目と当てるか。
    grid: { of: assignmentName, fixed: fixedName, dayIndex: dayIndex },
    sections: [
      {
        heading: null,
        startColumn: 1,
        // 担当者がセルを書き換えるのが仕様である（→ 5-3）ので、保護は「持ち主だけ」である（→ issue #234）。
        // 印のメモを消すと、次の生成で組み直す（→ issue #156）。お友達欄は生成が読まない（→ 5-2 ／ issue #200）。
        // note は作成者が読む説明なので、issue・docs の節番号を書かない（→ issue #249）。
        note: 'シフト表です（行が人・列が 30 分・セルが役割）。'
          + 'セルを書き換えると「シフト作成者による修正済み」のメモが付き、生成し直しても残ります（メモを消すと次の生成で作り直します）。'
          + '時刻の見出しと氏名・お友達欄は生成のたびに更新されます。'
          + 'お友達と組ませたいときは、手でセルを書き換えてください。',
        // 一緒に組みたいお友達は、担当者が手で寄せるときに読むだけの列である（→ issue #200）。
        columns: ['学籍番号', '氏名', '一緒に組みたいお友達'],
        // 右は時刻の列で、名前を持たない。当てるのは見出しの時刻である（→ assignment-grid.js）。
        slotColumns: maxSlotsPerDay,
        // 友達欄は長くなりうるので、時刻の列 3 つ分の幅を取る（→ issue #245）。
        wideColumns: { '一緒に組みたいお友達': 3 },
        // 友達欄と時刻の列の境に、固定の線（氏名と友達欄の境）と同じく目立つ線を引く（→ dividerLine ／ issue #245）。
        dividerAfter: '一緒に組みたいお友達',
      },
    ],
  }
}

/**
 * 区画の dividerAfter の列の右に引く線（→ issue #245）。固定の線に似せた、太い灰色である。
 * style は SpreadsheetApp.BorderStyle の名前で持つ（ここは SpreadsheetApp を掴まない）。
 * 生成と数え直しは塗り直すたびに書式を消すので、線もそのたびに引き直す（→ shell.js の paintGrids）。
 */
const dividerLine = { color: '#b7b7b7', style: 'SOLID_THICK' }

const sheetLayout = [
  {
    name: '条件入力',
    staffWrites: true,
    // 担当者が書くのは各区画の列名より下だけである。見出し・区画のあいだ・右端より右は誰も書かない
    // — 書き換えると走る前の検証で止まる（→ verify-structure.js）ので、そこだけに警告を出す（→ issue #234）。
    protect: { kind: protectionKind.warningOnly, note: inputProtectionNote, openInputs: true },
    hasSectionHeadings: true,
    // 各区画の initialRows は、テンプレートを作るときに列名の下へ置く初期値である（→ issue #240）。
    // 値は前回（2025 年）の条件である — 担当者は今年の値に書き換えてから走らせる（→ ADR tech-requirements-0015）。
    // 表現はコアが受け取る形（YYYY-MM-DD ／ HH:MM ／ 数。学年も数である → issue #237）で持つ。シートに置けば日付と時刻に読まれ、殻が同じ形に戻す。
    frozenRows: 2,
    sections: [
      {
        heading: '日ごとの営業時刻',
        startColumn: 1,
        // ここから 30 分枠を刻む（→ 5-1 の #1・規則 1 の ①）。片付け終了がその日の終わり（→ ADR tech-requirements-0006）。
        note: '1 日 1 行、4 日分（準備日・学祭1日目・学祭2日目・片付け の順）。'
          + '時刻は 8:00 のように、左から早い順に書きます。片付け終了がその日の終わりです。',
        columns: ['日付', '準備開始', '調理開始', '調理終了', '片付け開始', '片付け終了'],
        initialRows: [
          ['2025-11-01', '08:00', '21:00', '21:00', '21:00', '21:00'],
          ['2025-11-02', '08:00', '10:00', '18:00', '18:00', '20:00'],
          ['2025-11-03', '08:00', '10:00', '18:00', '18:00', '20:00'],
          ['2025-11-04', '08:00', '15:00', '15:00', '15:00', '15:00'],
        ],
      },
      {
        heading: '役割と必要人数',
        startColumn: 8,
        // 空けた日・時間帯の効き方は 5-1 の #2。
        note: '日を空けると全日、開始・終了を空けると調理開始〜調理終了のあいだに効きます。'
          + '準備・片付けの時間に人を置くときは、開始・終了を書いてください。',
        columns: ['日', '開始', '終了', '役割名', '人数'],
        initialRows: [
          ['', '', '', '調理責任者', 1],
          ['', '', '', '調理', 2],
          ['', '', '', '会計', 1],
          ['', '', '', '呼び込み', 2],
          ['', '', '', '列整理', 2],
          ['2025-11-01', '', '', '準備', 10],
          ['2025-11-02', '', '', '準備', 8],
          ['2025-11-03', '', '', '準備', 8],
          ['2025-11-04', '', '', '準備', 10],
          ['2025-11-02', '', '', '片付け', 15],
          ['2025-11-03', '', '', '片付け', 15],
        ],
      },
      {
        heading: '調理責任者の学年',
        startColumn: 14,
        // → 5-1 の #3・規則 4。
        note: '調理責任者にしてよい学年を 1 行に 1 つ、数字で書きます（3年生なら 3）。',
        columns: ['学年'],
        initialRows: [[3], [4]],
      },
      {
        heading: '委員会の指定枠',
        startColumn: 16,
        // フォーム作成後に来る ◎ ので、来たら行を足す（→ 5-1 の #4・規則 6）。役割名は「役割と必要人数」に無い名前でもよい。
        note: '「役割と必要人数」と同じ書き方です。委員会から指定が届いたら行を足してください。',
        columns: ['日', '開始', '終了', '役割名', '人数'],
        initialRows: [
          ['2025-11-02', '16:00', '17:00', 'クリーンパトロール', 3],
          ['2025-11-03', '12:00', '12:40', 'クリーンパトロール', 3],
        ],
      },
      {
        heading: '準備・片付けのルール',
        startColumn: 22,
        // → 5-1 の #5・規則 3。「複数日で偏らせない」の線は決まっていない（→ 9 の △ 5）。
        note: '項目「午前と午後の境目」の値に時刻（12:00 など）を書きます。',
        columns: ['項目', '値'],
        initialRows: [['午前と午後の境目', '12:00']],
      },
      {
        heading: '置き方のルール',
        startColumn: 25,
        // → 5-1 の #7・5-5。枠の刻み（30 分）は動かない — 動くのは置くときのまとまりだけである。
        note: '項目「連続して入る最小の長さ」の値に 1:00・1:30 のように 30 分単位で書きます（空なら 1 時間）。',
        columns: ['項目', '値'],
        initialRows: [['連続して入る最小の長さ', '1:00']],
      },
    ],
  },
  {
    name: '回答',
    staffWrites: false,
    protect: { kind: protectionKind.warningOnly, note: protectionNote },
    hasSectionHeadings: false,
    frozenRows: 1,
    sections: [
      {
        heading: null,
        startColumn: 1,
        // 列は 4-1 の設問 9 つ ＋ タイムスタンプの転記で、後ろ 4 列の列名は毎年変わる（設問の題そのものだからである → 4-1）。
        // 回答先をこのシートに向けるのは issue #144。
        note: 'フォームの回答が自動で入ります。手で書き換えないでください。',
        columns: [
          'タイムスタンプ',
          '学籍番号',
          '氏名',
          '学年',
          '調理担当ですか？',
          '一緒に組みたいお友達',
        ],
        // 後ろ 4 列は希望時間 4 設問で、列名（設問の題）が毎年変わるので名前を持たない。
        // 突き合わせも取り込みも位置で当てる（→ input-types.js の dayAnswerColumns）。
        yearlyColumns: 4,
      },
    ],
  },
  // 割り当ての 4 枚（→ gridSheet）。
  gridSheet(0),
  gridSheet(1),
  gridSheet(2),
  gridSheet(3),
  {
    name: '検証結果',
    staffWrites: false,
    protect: { kind: protectionKind.warningOnly, note: protectionNote },
    hasSectionHeadings: false,
    frozenRows: 1,
    sections: [
      {
        heading: null,
        startColumn: 1,
        // 種別で分けて並べる（→ 5-4）。残せなかった手直しは先頭に並ぶ（→ 5-3）。
        // 候補は、その行の 30 分枠を希望に含む人全員の氏名で、置いてあるか・ほかの条件に合うかは見ていない（→ issue #246）。
        note: '違反（条件に合わない配置）と人数不足を並べます。反映できなかった修正は先頭に出ます。'
          + '「候補」はその時間に出られると答えた人です（ほかの条件は見ていません）。',
        columns: ['種別', '日', '開始', '終了', '役割', '学籍番号', '氏名', '内容', 'あと何人', '候補'],
        // 候補は名前が何人も並ぶので、ほかの列（あと何人）の 5 倍の幅を取る（→ issue #246 ／ widthBaseColumn）。
        wideColumns: { '候補': 5 },
      },
    ],
  },
  {
    name: '指標',
    staffWrites: false,
    protect: { kind: protectionKind.warningOnly, note: protectionNote },
    hasSectionHeadings: false,
    frozenRows: 1,
    sections: [
      {
        heading: null,
        startColumn: 1,
        // 人ごとに 3 つ並べるだけで、順位付けも閾値も出さない（→ 5 の #7・上流の △ 5）。数え方は 5-6。
        note: '合計時間（30 分＝0.5、準備・片付けを含む）／シフト回数（同じ役割が続いたまとまりの数）／'
          + '準備回数（準備か片付けに入った日数）です。',
        columns: ['学籍番号', '氏名', '合計時間', 'シフト回数', '準備回数'],
      },
    ],
  },
]

/**
 * 検証結果シートの「種別」に入る 3 つ。値がそのままシートに書かれる。
 * 食い違った固定（残せなかった手直し → 5-3）は置いていないので、違反とも未充足とも別にする。
 */
const checkKind = { violation: '違反', unmet: '未充足', fixConflict: '反映できなかった修正' }

/**
 * コードの食い違い（バグ）のときだけ起きる止まり方の例外を作る（→ issue #249）。
 * 作成者には直しようがないので、見せるのは連絡を促す一文だけにし、元の文は console と detail に残す。
 * どの検査もこのファイルを最初に読むので、ここに置く。
 */
function internalError(detail) {
  if (typeof console !== 'undefined' && typeof console.error === 'function') console.error(detail)
  const error = new Error(internalErrorMessage)
  error.detail = detail
  return error
}

/** internalError が作成者に見せる文。 */
const internalErrorMessage = '処理中に問題が起きました。開発者に連絡してください'

/** 検証結果の「候補」で、人と人のあいだに置く区切り。コアは学籍番号を、殻は氏名をこれでつなぐ（→ issue #246）。 */
const candidateSeparator = '、'

/**
 * 区画の幅（名前のある列 ＋ 名前を持たない列）。
 * 読む幅も列数を見る所も、列名の数ではなくこれを使う。
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

/** 区画の右端の列 ＝ そのシートが要る列数。テンプレートを広げる側と列数を照らす側が同じここを見る。 */
function sectionRightEdge(layout) {
  return layout.sections.reduce((rightEdge, section) => Math.max(rightEdge, section.startColumn + sectionWidth(section) - 1), 0)
}

/** 区画の dividerAfter が何列目か（1 始まり）。線を引かない区画は null である。 */
function dividerColumn(section) {
  if (!section.dividerAfter) return null
  return section.startColumn + section.columns.indexOf(section.dividerAfter)
}

/**
 * 広く取る列（wideColumns）の幅の物差しにする列（1 始まり）— 区画の中で、広げない列のうち一番右である。
 * マス目なら時刻の列、検証結果なら「あと何人」になる。右端の列そのものを広げる区画で右端を物差しにすると、
 * テンプレートを作り直すたびに幅が倍々に伸びる（→ issue #246）。
 */
function widthBaseColumn(section) {
  const wide = section.wideColumns || {}
  let column = section.startColumn + sectionWidth(section) - 1
  while (column > section.startColumn && wide[section.columns[column - section.startColumn]] !== undefined) column -= 1
  return column
}

/** 生成が返す行の形。シートの列名で、マス目に載る「割り当て」だけは assignmentColumns である。 */
function outputColumns(name) {
  if (name === assignmentName) return assignmentColumns
  const layout = sheetLayout.filter((c) => c.name === name)[0]
  if (!layout) throw internalError(`シートの構成に「${name}」が無い`)
  return layout.sections[0].columns
}

/** 割り当ての「区画」。読む側が他のシートと同じ手で列を引けるよう、行の形から組む。 */
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
    sheetLayout, checkKind, candidateSeparator, protectionKind, protectionNote, gridProtectionNote, inputProtectionNote, sectionWidth, sectionColumnsText, sectionRightEdge,
    dividerLine, dividerColumn, widthBaseColumn,
    dayLabels, assignmentName, assignmentColumns, fixedName, fixedColumns, maxSlotsPerDay, outputColumns, assignmentSection, gridLayouts,
  }
}
