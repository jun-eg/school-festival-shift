// E2E に流すモックと、その相手になる Node のコアの出力。
//
// 実機に置くのは、data/ の希望データのモック（氏名・学籍番号とも作りもの）と、buildTemplate が置いた条件入力の初期値（条件入力には手を入れない）だけである。
// 相手は、同じ回答と同じ初期値を src/core/ の build に通した出力である。規則も数え方もここでは書き直さない。

import fs from 'node:fs'
import path from 'node:path'
import { build } from '../src/core/core.ts'
import { toAssignmentGrid } from '../src/core/assignment-grid.ts'
import { expand } from '../src/core/expand.ts'
import { toDays } from '../src/core/input-types.ts'
import { assignmentName, gridLayouts, sheetLayout } from '../src/core/sheet-layout.ts'
import { takeIn } from '../src/core/take-in.ts'
import { gridContext, withNamesFromAnswers } from '../src/shell/shell.ts'
import { root } from './env.mjs'

/** 引用符の中のコンマを割らないだけの CSV の読み（友達欄が引用符付きで入っている）。 */
function readCsv(text) {
  return text
    .replace(/^﻿/, '')
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const cells = []
      let held = ''
      let quoted = false
      for (const char of line) {
        if (char === '"') quoted = !quoted
        else if (char === ',' && !quoted) {
          cells.push(held)
          held = ''
        } else held += char
      }
      cells.push(held)
      return cells
    })
}

const two = (n) => String(n).padStart(2, '0')

/** CSV のタイムスタンプ（2025/09/23 16:31:09）を、コアが受け取る形（YYYY-MM-DD HH:MM:SS）にする。 */
function timestampOf(text) {
  const [date, time] = text.split(' ')
  const [year, month, day] = date.split('/').map(Number)
  const [hour, minute, second] = time.split(':').map(Number)
  return `${year}-${two(month)}-${two(day)} ${two(hour)}:${two(minute)}:${two(second)}`
}

/** 条件入力の初期値（buildTemplate が置いたもの）を、コアの入力の形にする。 */
export function conditionInputs() {
  const inputs = {}
  for (const section of sheetLayout[0].sections) inputs[section.heading] = section.initialRows
  return inputs
}

/**
 * 回答シートに置く行（見出しは除く）と、そこから外した人。
 * 終端 ≤ 始端の区間を書いた人は展開の段で止まり、生成が走らないので外す（scripts/生成の所要時間.mjs と同じ置き方）。
 */
export function mockAnswers() {
  const all = readCsv(fs.readFileSync(path.join(root, 'data/前回の希望データ-モック.csv'), 'utf8'))
    .slice(1)
    .map((row) => [timestampOf(row[0]), ...row.slice(1)])
  const days = toDays(conditionInputs()['日ごとの営業時刻'], '日ごとの営業時刻')
  const stopped = takeIn(all)
    .filter((wish) => {
      try {
        expand([wish], days)
        return false
      } catch {
        return true
      }
    })
    .map((wish) => wish.studentId)
  return { rows: all.filter((row) => !stopped.includes(String(row[1]).toUpperCase())), stopped }
}

/** 同じモックと条件入力を Node のコアに通した出力と、それをシートに敷いたときの形。 */
export function expectedFromCore() {
  const { rows, stopped } = mockAnswers()
  const inputs = { ...conditionInputs(), 回答: rows, [assignmentName]: [], 手直し: [] }
  const output = build(inputs)
  const context = gridContext(inputs)
  const grids = gridLayouts(assignmentName).map((layout) => ({
    layout,
    grid: toAssignmentGrid(output[assignmentName], context.days[layout.grid.dayIndex], context.nameOf, [], context.friendsOf),
  }))
  return {
    stopped,
    answers: rows,
    // Execution API は JSON で返すので、同じ通り道を通して比べる
    output: JSON.parse(JSON.stringify(output)),
    days: context.days,
    grids,
    // 検証結果と指標は、氏名を空で返すので回答から埋めて置かれる（shell.ts の writeOutputs）
    checkRows: withNamesFromAnswers(output['検証結果'], '検証結果', context.nameOf),
    metricRows: withNamesFromAnswers(output['指標'], '指標', context.nameOf),
  }
}
