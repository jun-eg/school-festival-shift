/**
 * シート 5 枚の構成。
 *
 * docs/tech-requirements.md 2「実行形態と前提」の「何で動かすか」が決めた
 * 「条件の入力・回答・割り当て・検証結果が同じ 1 ファイルの中のシートとして並ぶ」の実体である。
 * 列の中身は 5-1「入力の型」と 5-4「『違反』と『未充足』は別に数える」から降ろした。
 *
 * ここは値を持たない定義だけである。SpreadsheetApp を 1 度も掴まない（→ 6 の #8）。
 * 入力の初期値も持たない — テンプレートが空であること自体が
 * 「前年の値を既定にしない ◎」（5-1 の #1）を満たしている（→ 6 の #1 の却下側）。
 */

/** 生成シートの保護にかける説明文。保護の強さについては src/README.md を読む。 */
const protectionNote = 'スクリプトが書くシートである（手で書き換えない）'

const sheetLayout = [
  {
    name: '条件入力',
    staffWrites: true,
    protect: false,
    hasSectionHeadings: true,
    frozenRows: 2,
    sections: [
      {
        heading: '日ごとの営業 4 時刻',
        startColumn: 1,
        note: '1 日 1 行。時刻は HH:MM で書く。ここから 30 分枠を刻む（→ 5-1 の #1・規則 1 の ①）',
        columns: ['日付', '準備開始', '調理開始', '調理終了', '片付け開始'],
      },
      {
        heading: '役割と必要人数',
        startColumn: 7,
        note: '(日・時間帯・役割名・人数) の行。日と時間帯を空けた行は全枠に効く（→ 5-1 の #2）',
        columns: ['日', '開始', '終了', '役割名', '人数'],
      },
      {
        heading: '調理責任者の学年',
        startColumn: 13,
        note: '調理責任者の枠に置いてよい学年を 1 行 1 つ（→ 5-1 の #3・規則 4）',
        columns: ['学年'],
      },
      {
        heading: '委員会の指定枠',
        startColumn: 15,
        note: '「役割と必要人数」と同じ形。役割名はそちらに無い名前でもよい。'
          + 'フォーム作成後に来る ◎ ので、来たら行を足す（→ 5-1 の #4・規則 6）',
        columns: ['日', '開始', '終了', '役割名', '人数'],
      },
      {
        heading: '準備・片付けのルール',
        startColumn: 21,
        note: '午前／午後の境目を HH:MM で書く（→ 5-1 の #5・規則 3）。'
          + '「複数日で偏らせない」の線は決まっていない（→ 9 の △ 5）',
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
          + '回答先をこのシートに向けるのは issue #144',
        columns: [
          'タイムスタンプ',
          '学籍番号',
          '氏名',
          '学年',
          '調理担当ですか？',
          '一緒に組みたいお友達',
          '11月1日(準備日)',
          '11月2日(学祭1日目)',
          '11月3日(学祭2日目)',
          '11月4日(片付け)',
        ],
      },
    ],
  },
  {
    name: '割り当て',
    staffWrites: true,
    protect: false,
    hasSectionHeadings: false,
    frozenRows: 1,
    sections: [
      {
        heading: null,
        startColumn: 1,
        note: '生成の結果。担当者がセルを書き換えるのが仕様である（→ 5-3）ので、保護をかけない',
        columns: ['日', '開始', '終了', '役割', '学籍番号', '氏名'],
      },
    ],
  },
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

// Node から読むためだけの口。Apps Script では module が無いので通らない。
if (typeof module !== 'undefined') {
  module.exports = { sheetLayout, checkKind, protectionNote }
}
