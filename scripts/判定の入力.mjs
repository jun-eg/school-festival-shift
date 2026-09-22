// 判定の入力 — M2 と同じ入力を 1 か所で組む。
//
//   使う側: scripts/M2の判定.mjs ／ scripts/まとまりと散らし.mjs ／ scripts/M4の判定.mjs
//   宣言:   scripts/M2の宣言.json（置き方の原本はあちらである。このファイルは値を 1 つも持たない）
//
// ここに置いてあるのは「同じ案の上で数えるための入力を組む手」だけである。
// 別々に入力を組むと、片方が古くなる（→ src/README.md の同じ注意）。
// 合格の線も数え方も持たない — 線は使う側の宣言が持つ。
//
// 何も書き換えない。読むだけである。

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { 営業時刻の行 } from './前回の5時刻.mjs'

const ここ = path.dirname(fileURLToPath(import.meta.url))
const 根 = path.dirname(ここ)

/** リポジトリの根からの相対で読む。 */
export function 読む(相対) {
  return fs.readFileSync(path.join(根, 相対), 'utf8')
}

/** M2 の宣言。入力の置き方の原本である。 */
export const 宣言 = JSON.parse(読む('scripts/M2の宣言.json'))

/**
 * 実装を読んだ文脈を作る。
 * SpreadsheetApp を文脈に置いていない（置かなくても通ることは src/core.test.mjs の側が見ている）。
 * 判定の側で規則も数え方も書き直さない — 書き直した規則で 0 件になっても、答えにならない。
 */
export function 実装の文脈() {
  const 文脈 = vm.createContext({})
  for (const 相対 of 宣言.入力.実装) {
    vm.runInContext(読む(相対), 文脈, { filename: path.basename(相対) })
  }
  return 文脈
}

/** 文脈から名前を取り出す。どの名前が要るかは使う側が決める。 */
export function 取り出す(文脈, 名前) {
  return vm.runInContext(`({ ${名前.join(', ')} })`, 文脈)
}

/** 引用符の中のコンマを割らないだけの CSV の読み。友達欄が引用符付きで入っている。 */
export function CSVを読む(文) {
  return 文.replace(/^﻿/, '').trim().split(/\r?\n/).map((行) => {
    const セル = []
    let 溜め = ''
    let 引用符の中 = false
    for (const 文字 of 行) {
      if (文字 === '"') 引用符の中 = !引用符の中
      else if (文字 === ',' && !引用符の中) { セル.push(溜め); 溜め = '' }
      else 溜め += 文字
    }
    セル.push(溜め)
    return セル
  })
}

/**
 * 判定に食わせる入力の一式を組む（→ 宣言の「入力」）。
 *
 * 条件入力の「日ごとの営業時刻」は data/ の前回の確定シフトから毎回算出する
 * （→ scripts/前回の5時刻.mjs）。残りの区画は宣言のままである。
 * 終端 ≤ 始端の区間を書いた人は展開の段が名指しして止まる（→ 宣言の「展開で止まる 3 人を外すこと」）ので、
 * その人の回答の行を外してから組む。誰を外したかは名指しで返す。
 */
export function 判定の入力(文脈) {
  const { toDays, formatDateTime, takeIn, expand } = 取り出す(文脈, ['toDays', 'formatDateTime', 'takeIn', 'expand'])

  /** モックを回答シートに貼ると、タイムスタンプのセルは日時になる（→ src/take-in.test.mjs の同じ手）。 */
  const 回答シートの行にする = (行) => {
    const [年, 月, 日] = 行[0].split(' ')[0].split('/').map(Number)
    const [時, 分, 秒] = 行[0].split(' ')[1].split(':').map(Number)
    return [formatDateTime(new Date(年, 月 - 1, 日, 時, 分, 秒))].concat(行.slice(1))
  }

  const 回答の全行 = CSVを読む(読む(宣言.入力.回答)).slice(1).map(回答シートの行にする)
  const 日ごと = toDays(営業時刻の行(), '日ごとの営業時刻')
  const 希望 = takeIn(回答の全行)

  const 止まる人 = 希望
    .filter((一人) => {
      try {
        expand([一人], 日ごと)
        return false
      } catch (例外) {
        return true
      }
    })
    .map((一人) => 一人.studentId)

  const 組む回答 = 回答の全行.filter((行) => 止まる人.indexOf(String(行[1]).toUpperCase()) === -1)
  const 条件入力 = 宣言.入力.条件入力
  const 項目と値の行 = (区画) => Object.entries(条件入力[区画]).map(([項目, 値]) => [項目, 値])

  return {
    入力: {
      '日ごとの営業時刻': 営業時刻の行(),
      '役割と必要人数': 条件入力.役割と必要人数,
      '調理責任者の学年': 条件入力.調理責任者の学年.map((学年) => [学年]),
      '委員会の指定枠': 条件入力.委員会の指定枠,
      '準備・片付けのルール': 項目と値の行('準備・片付けのルール'),
      '置き方のルール': 項目と値の行('置き方のルール'),
      '回答': 組む回答,
      '割り当て': [],
      '手直し': [],
    },
    回答の全行: 回答の全行,
    日ごと: 日ごと,
    希望: 希望,
    止まる人: 止まる人,
  }
}
