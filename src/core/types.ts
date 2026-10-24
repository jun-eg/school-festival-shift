/**
 * コアの入出力の型（docs/agent/tech-requirements.md 5-1 の入力 7 種類と、5-4 ／ 5 の #7 の出力の行）。
 *
 * 殻が読んだ行（Row）を 7 種類の型に直すのが input-types.ts で、ここはその「直した先」の形を持つ。
 * 型だけを置き、値を 1 つも持たない（import type で読まれ、実行時には消える）。
 */

/** 殻が表現を揃えたあとのセル。文字列か数値だけが来る（→ core.ts の checkRepresentation）。 */
export type Cell = string | number

/** シートの 1 行。コアの入口でも出口でも、行はこの形である。 */
export type Row = Cell[]

/** 30 分枠 1 つ。時刻は HH:MM。 */
export type Slot = { start: string; end: string }

/** 型 #1（枠）— 日ごとの営業時刻と、そこから刻んだ 30 分枠。 */
export type Day = {
  date: string
  prepStart: string
  cookStart: string
  cookEnd: string
  cleanupStart: string
  cleanupEnd: string
  slots: Slot[]
}

/** Day の時刻の項目の名前（準備・調理・片付けの 5 時刻）。 */
export type TimeKey = 'prepStart' | 'cookStart' | 'cookEnd' | 'cleanupStart' | 'cleanupEnd'

/** 型 #1 を作る途中の形（枠を刻む前）。 */
export type DayTimes = Omit<Day, 'slots'>

/** 型 #2（役割と必要人数）・型 #4（委員会の指定枠）の 1 行。日・開始・終了は空でもよい。 */
export type Need = { date: string; start: string; end: string; role: string; count: number }

/** 型 #3（調理責任者の学年条件）— 学年の集合。 */
export type CookLeaderGrades = string[]

/** 型 #5（準備・片付けのルール）。 */
export type PrepCleanupRule = { noonBoundary: string }

/** 型 #7（置き方のルール）。minRun は分である。 */
export type PlacementRule = { minRun: number }

/** 型 #6（希望）— 回答 1 件。answers は日ごとの回答 4 つ（位置のまま）。 */
export type Wish = { studentId: string; grade: string; canCook: boolean; answers: string[] }

/** 条件入力の 6 区画を型に直したもの（→ core.ts の takeConditions）。キーは input-types.ts の key である。 */
export type Conditions = {
  days: Day[]
  roleNeeds: Need[]
  cookLeaderGrades: CookLeaderGrades
  committeeNeeds: Need[]
  prepCleanupRule: PrepCleanupRule
  placementRule: PlacementRule
}

/** 展開する段の出力 — 1 人 1 日の候補の枠。 */
export type Candidate = { studentId: string; date: string; slots: Slot[] }

/** コアが受け取る入力 — 入力の名前から行の配列への対応（→ core.ts の inputNames）。 */
export type Inputs = Record<string, Row[]>

/** 割り当ての行を読んだもの（→ count-violations.ts の readAssignments）。 */
export type Placement = {
  date: string
  start: string
  end: string
  role: string
  studentId: string
  name: string
}

/** 手直し 1 件（枠に直す前の行を読んだもの → generate.ts の fixedToPlace）。 */
export type FixedLine = {
  index: number
  date: string
  start: string
  role: string
  studentId: string
  day: Day | undefined
  dayIndex: number
  slot: Slot | null
  slotIndex: number
}

/** 中身の入っていない段の名指し（→ core.ts の coreSteps）。 */
export type NotBuiltStep = { name: string; issue: number; writesTo: string | null; whatItDoes: string }

/** 段の関数。引数は段ごとに違う（→ core.ts の build）ので、ここでは束ねて持つ。 */
export type StepFunction = (...args: any[]) => unknown[]

/** 段の名前から関数への対応。 */
export type Steps = Record<string, StepFunction>

/** コアが返す束（→ core.ts の build）。 */
export type Output = {
  割り当て: Row[]
  検証結果: Row[]
  指標: Row[]
  notBuilt: NotBuiltStep[]
}

/** 割り当てのマス目 1 枚（→ assignment-grid.ts）。header は名前のある列の見出しと時刻、rows は人ごとの行。 */
export type Grid = { header: Row; rows: Row[] }

/** ダイアログから google.script.run で届く、選んだ画像（→ ui/form-picker.ts ／ shell/build-form.ts）。 */
export type PickedRoster = { base64: string; mimeType: string; fileName: string }

/** フォームを作った結果。ダイアログの成功ハンドラに渡る（→ ui/form-picker.ts の done）。 */
export type BuiltForm = { url: string; editUrl: string; log: string[] }

/** 殻が読んだ回答から、学籍番号で引く関数。 */
export type ByStudentId = (studentId: string) => string
