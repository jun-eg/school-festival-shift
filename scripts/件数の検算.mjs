#!/usr/bin/env node
// 件数の検算 — data/ の 5 本だけを入力に件数を数え直し、期待値と突き合わせる。
//
//   使い方: node scripts/件数の検算.mjs
//   期待値: scripts/件数の期待値.json（期待値をこのファイルに書かない。数え方もあちらが持つ）
//
// 見るものは 3 つある。
//   ① data/ から数え直した値が、期待値と一致するか
//   ② その数字が本文（docs/tech-requirements.md の 4-5・7 ／ data/前回の確定シフト.md）に載っているか
//      — 載っているかだけを見る。本文は解析しない
//   ③ 数え方の宣言（出し直しの畳み方・重なりの定義・slotId の一致の定義）を出力の頭に出す
//
// 何も書き換えない。読むだけである。不一致があれば終了コード 1 で落ちる。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ここ = path.dirname(fileURLToPath(import.meta.url))
const 根 = path.dirname(ここ)
const 読む = (相対) => fs.readFileSync(path.join(根, 相対), 'utf8')

const 期待 = JSON.parse(読む('scripts/件数の期待値.json'))

// ---- 入力を読む ------------------------------------------------------------

/** 確定シフトのモック 4 本を、割り当て 1 行 = 1 要素に開く。 */
function 確定シフトを読む() {
  const 行 = []
  let のべ = 0
  for (const 相対 of 期待.入力.確定シフト) {
    const j = JSON.parse(読む(相対))
    のべ += j.results.length
    for (const r of j.results) {
      for (const a of r.assigned) {
        行.push({ memberId: r.memberId, name: r.name, ...a })
      }
    }
  }
  return { 行, のべ }
}

/** 素の CSV パーサ（引用符と埋め込み改行に対応する）。 */
function csvを開く(s) {
  const 表 = []
  let 行 = [], 欄 = '', 引用中 = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (引用中) {
      if (c !== '"') { 欄 += c }
      else if (s[i + 1] === '"') { 欄 += '"'; i++ }
      else { 引用中 = false }
    } else if (c === '"') { 引用中 = true }
    else if (c === ',') { 行.push(欄); 欄 = '' }
    else if (c === '\n') { 行.push(欄); 表.push(行); 行 = []; 欄 = '' }
    else if (c !== '\r') { 欄 += c }
  }
  if (欄 !== '' || 行.length) { 行.push(欄); 表.push(行) }
  return 表
}

function 希望データを読む() {
  const 表 = csvを開く(読む(期待.入力.希望データ).replace(/^﻿/, ''))
  const 見出し = 表[0]
  const 行 = 表.slice(1).filter((r) => r.some((c) => c !== ''))
  const 列 = Object.fromEntries(見出し.map((名, i) => [名, i]))
  return { 見出し, 行, 列 }
}

// ---- 数え方（期待値ファイルが宣言したもの） ---------------------------------

const 分 = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }

/** 重なりの定義: 端が接するだけは重なりに数えない。 */
const 重なる = (a, b) => 分(a.start) < 分(b.end) && 分(b.start) < 分(a.end)

/** slotId の一致の定義: <日>T<時刻>_<役割名> として読む。読めなければ null。 */
const slotIdを読む = (s) => {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{1,2}:\d{2})_(.+)$/.exec(s)
  return m && { date: m[1], time: m[2], role: m[3] }
}

const 三十分に乗る = (t) => /^\d{1,2}:(00|30)$/.test(t)

const 時刻 = (s) => {
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2}) (\d{1,2}):(\d{2}):(\d{2})$/.exec(s.trim())
  if (!m) throw new Error(`タイムスタンプが読めない: ${s}`)
  return { 値: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]), 時分: `${+m[4]}:${m[5]}` }
}

const 境目の時刻 = (文字列) => {
  const m = /^(\d{4})-(\d{2})-(\d{2}) の 24 時$/.exec(文字列)
  if (!m) throw new Error(`境目が読めない: ${文字列}`)
  return Date.UTC(+m[1], +m[2] - 1, +m[3], 23, 59, 59)
}

/** 出し直しの畳み方: 同じ学籍番号のうち最後の行を採る（宣言は期待値ファイル）。 */
const 畳む = (行, 列, 最後を採る = true) => {
  const m = new Map()
  for (const r of 行) {
    const id = r[列['学籍番号']]
    if (最後を採る || !m.has(id)) m.set(id, r)
  }
  return [...m.values()]
}

// ---- 数え直す --------------------------------------------------------------

function 確定シフトを数える() {
  const { 行, のべ } = 確定シフトを読む()
  const 数え = {}

  数え['確定シフト-assigned行数'] = { 行数: 行.length }

  数え['確定シフト-人の数え'] = {
    'results のべ': のべ,
    学籍番号の種類: new Set(行.map((r) => r.memberId)).size,
    氏名の種類: new Set(行.map((r) => r.name)).size,
  }

  let 時刻だけ = 0, 役割だけ = 0, 両方 = 0, 日付 = 0, 読めない = 0
  for (const r of 行) {
    const p = slotIdを読む(r.slotId)
    if (!p) { 読めない++; continue }
    if (p.date !== r.date) 日付++
    const t = p.time !== r.start, k = p.role !== r.role
    if (t && k) 両方++
    else if (t) 時刻だけ++
    else if (k) 役割だけ++
  }
  数え['確定シフト-slotIdの不一致'] = {
    不一致: 時刻だけ + 役割だけ + 両方,
    時刻だけ違う: 時刻だけ,
    役割だけ違う: 役割だけ,
    両方違う: 両方,
    日付が違う: 日付,
    読めなくて除いた行: 読めない,
  }

  const 乗らないslotId = 行.filter((r) => {
    const p = slotIdを読む(r.slotId)
    return p && !三十分に乗る(p.time)
  })
  数え['確定シフト-slotIdの時刻'] = {
    行数: 乗らないslotId.length,
    種類: new Set(乗らないslotId.map((r) => r.slotId)).size,
  }

  数え['確定シフト-区間の刻み'] = {
    行数: 行.filter((r) => !三十分に乗る(r.start) || !三十分に乗る(r.end)).length,
  }

  const 同じslotId = new Map()
  for (const r of 行) {
    const k = `${r.memberId}\t${r.slotId}`
    同じslotId.set(k, (同じslotId.get(k) ?? 0) + 1)
  }
  数え['確定シフト-同じslotIdが2行'] = {
    件数: [...同じslotId.values()].filter((n) => n >= 2).length,
  }

  const 人日ごと = new Map()
  for (const r of 行) {
    const k = `${r.memberId}\t${r.date}`
    if (!人日ごと.has(k)) 人日ごと.set(k, [])
    人日ごと.get(k).push(r)
  }
  let 自分の重なり = 0
  for (const g of 人日ごと.values()) {
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) if (重なる(g[i], g[j])) 自分の重なり++
    }
  }
  数え['確定シフト-同じ人の重なり'] = { 件数: 自分の重なり }

  const 氏名ごとの学籍番号 = new Map()
  for (const r of 行) {
    if (!氏名ごとの学籍番号.has(r.name)) 氏名ごとの学籍番号.set(r.name, new Set())
    氏名ごとの学籍番号.get(r.name).add(r.memberId)
  }
  const 割れた氏名 = [...氏名ごとの学籍番号.entries()].filter(([, s]) => s.size >= 2).map(([n]) => n)
  数え['確定シフト-同じ氏名に学籍番号が2つ'] = { 組数: 割れた氏名.length, 氏名: 割れた氏名 }

  let 群の間 = 0, 完全一致 = 0
  for (const 名 of 割れた氏名) {
    const g = 行.filter((r) => r.name === 名)
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        const a = g[i], b = g[j]
        if (a.memberId === b.memberId || a.date !== b.date || !重なる(a, b)) continue
        群の間++
        if (a.start === b.start && a.end === b.end && a.role === b.role) 完全一致++
      }
    }
  }
  数え['確定シフト-別人2群の重なり'] = {
    件数: 群の間,
    '完全に同じ区間・同じ役割': 完全一致,
    一部だけ重なる: 群の間 - 完全一致,
  }

  return 数え
}

function 希望データを数える() {
  const { 見出し, 行, 列 } = 希望データを読む()
  const 数え = {}

  数え['希望データ-形'] = { 列: 見出し.length, 行: 行.length }

  const 学籍番号 = (r) => r[列['学籍番号']]
  const 種類 = new Set(行.map(学籍番号))
  数え['希望データ-実人数'] = { 人数: 種類.size }
  数え['希望データ-出し直し'] = { 畳まれる行: 行.length - 種類.size }

  const 友達欄 = (r) => r[列['一緒に組みたいお友達']].trim()
  const 最後で畳んだ = 畳む(行, 列, true)
  const 最初で畳んだ = 畳む(行, 列, false)
  const 記入の数 = (xs) => xs.filter((r) => 友達欄(r) !== '').length
  数え['希望データ-友達欄'] = {
    記入: 記入の数(最後で畳んだ),
    空欄: 最後で畳んだ.length - 記入の数(最後で畳んだ),
    最初の行で畳んだときの記入: 記入の数(最初で畳んだ),
    最初の行で畳んだときの空欄: 最初で畳んだ.length - 記入の数(最初で畳んだ),
  }

  // 参照の解決は大文字・小文字を無視する（docs/tech-requirements.md 7「友達欄の参照先の解決」）。
  const 提出者 = new Set([...種類].map((s) => s.toUpperCase()))
  const 参照を数える = (xs) => {
    let 参照 = 0, 解決 = 0
    for (const r of xs) {
      const v = 友達欄(r)
      if (!v) continue
      for (const x of v.split(',')) {
        参照++
        if (提出者.has(x.trim().toUpperCase())) 解決++
      }
    }
    return { 参照, 解決 }
  }
  const 畳んだ参照 = 参照を数える(最後で畳んだ)
  const 全行の参照 = 参照を数える(行)
  数え['希望データ-友達欄の参照'] = {
    解決: 畳んだ参照.解決,
    参照: 畳んだ参照.参照,
    '全 50 行での解決': 全行の参照.解決,
    '全 50 行での参照': 全行の参照.参照,
  }

  const 締切 = 境目の時刻(期待.境目.締切.値)
  const 配布 = 境目の時刻(期待.境目.配布.値)
  const ts = (r) => 時刻(r[列['タイムスタンプ']])
  const 締切後 = 行.filter((r) => ts(r).値 > 締切)
  const 締切後の人 = new Set(締切後.map(学籍番号))
  let 間に合わなかった = 0, 出し直し = 0
  for (const id of 締切後の人) {
    if (行.some((r) => 学籍番号(r) === id && ts(r).値 <= 締切)) 出し直し++
    else 間に合わなかった++
  }
  数え['希望データ-締切後の提出'] = {
    人数: 締切後の人.size,
    間に合わなかった人: 間に合わなかった,
    締切内提出者の出し直し: 出し直し,
  }

  const 証言者 = new Set(期待.境目['証言者 5 人'].値)
  const 証言者の行 = 行.filter((r) => 証言者.has(r[列['氏名']]))
  数え['希望データ-証言者の提出'] = {
    件数: 証言者の行.length,
    時刻: 証言者の行
      .map(ts)
      .sort((a, b) => a.値 - b.値)
      .map((t) => t.時分),
  }

  数え['希望データ-配布後に届いた希望'] = { 行数: 行.filter((r) => ts(r).値 > 配布).length }

  const 営業 = 期待.境目.営業時間.値
  const 終日出れない = 期待.境目.終日出れない.値
  let 外 = 0, 逆 = 0
  for (const r of 行) {
    for (const 設問 of Object.keys(営業)) {
      const v = r[列[設問]].trim()
      if (!v) continue
      for (const 区間 of v.split(',')) {
        if (区間 === 終日出れない) continue
        const [s, e] = 区間.split('-')
        if (分(e) <= 分(s)) { 逆++; continue }
        if (分(s) < 分(営業[設問][0]) || 分(e) > 分(営業[設問][1])) 外++
      }
    }
  }
  数え['希望データ-営業時間の外'] = { 件数: 外 }
  数え['希望データ-終端が始端以下'] = { 件数: 逆 }

  return 数え
}

// ---- 本文に載っているかを見る（解析はしない） -------------------------------

/** 見出し行の頭が 節 と一致する節を切り出す。同じか浅い見出しが来るまで。 */
function 節を切り出す(本文, 節) {
  const 行 = 本文.split('\n')
  const 始め = 行.findIndex((l) => /^#{1,6} /.test(l) && l.startsWith(節))
  if (始め < 0) return null
  const 深さ = /^(#{1,6}) /.exec(行[始め])[1].length
  let 終わり = 行.length
  for (let i = 始め + 1; i < 行.length; i++) {
    const m = /^(#{1,6}) /.exec(行[i])
    if (m && m[1].length <= 深さ) { 終わり = i; break }
  }
  return 行.slice(始め, 終わり).join('\n')
}

/** 数字が「数字として」出てくるか。時刻や日付の一部は数えない。 */
const 数字が載っている = (本文, n) =>
  new RegExp(`(?<![\\d:：\\-−])${n}(?![\\d:：\\-−])`).test(本文)

function 本文を見る(検算) {
  const 結果 = []
  for (const 項 of 検算) {
    for (const 先 of 項.本文 ?? []) {
      const 全文 = 読む(先.ファイル)
      const 範囲 = 先.節 ? 節を切り出す(全文, 先.節) : 全文
      const 場所 = 先.節 ? `${先.ファイル}（${先.節}）` : 先.ファイル
      if (範囲 === null) {
        結果.push({ id: 項.id, 場所, 欠け: [`節「${先.節}」が見つからない`] })
        continue
      }
      const 欠け = []
      for (const n of 先.数字 ?? []) if (!数字が載っている(範囲, n)) 欠け.push(String(n))
      for (const s of 先.文字列 ?? []) if (!範囲.includes(s)) 欠け.push(s)
      結果.push({ id: 項.id, 場所, 欠け })
    }
  }
  return 結果
}

// ---- 突き合わせて出す ------------------------------------------------------

const 同じ値 = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const 値を書く = (o) =>
  Object.entries(o)
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(' ') : v}`)
    .join('  ')

function 主処理() {
  const 数え = { ...確定シフトを数える(), ...希望データを数える() }

  console.log('件数の検算 — data/ の 5 本から数え直し、期待値と本文に突き合わせる')
  console.log('')
  console.log('数え方（宣言。原本は scripts/件数の期待値.json）')
  for (const d of 期待.数え方) {
    console.log(`  ・${d.何}: ${d.決め}`)
    console.log(`      なぜ宣言が要るか: ${d.なぜ宣言が要るか}`)
    if (d.確かめること) console.log(`      確かめること: ${d.確かめること}`)
  }
  console.log('')
  console.log('境目（記録から引いた値。書き換えない）')
  for (const [名, v] of Object.entries(期待.境目)) {
    console.log(`  ・${名}: ${typeof v.値 === 'object' ? JSON.stringify(v.値) : v.値}`)
  }

  let 落ちた = 0
  let 入力 = null
  console.log('')
  console.log(`件数（${期待.検算.length} 種）`)
  for (const 項 of 期待.検算) {
    if (項.入力 !== 入力) {
      入力 = 項.入力
      const 出典 = 入力 === '確定シフト' ? 期待.入力.確定シフト.join(' / ') : 期待.入力.希望データ
      console.log(`  [${入力}] ${出典}`)
    }
    const 実測 = 数え[項.id]
    if (!実測) {
      console.log(`  NG   ${項.見出し}`)
      console.log(`         数え直す手が無い（id: ${項.id}）`)
      落ちた++
      continue
    }
    const 期待の鍵 = Object.keys(項.期待値).sort()
    const 実測の鍵 = Object.keys(実測).sort()
    const 一致 = 同じ値(期待の鍵, 実測の鍵) && 期待の鍵.every((k) => 同じ値(項.期待値[k], 実測[k]))
    console.log(`  ${一致 ? 'OK ' : 'NG '}  ${項.見出し}`)
    console.log(`         ${値を書く(実測)}`)
    if (!一致) {
      console.log(`         期待: ${値を書く(項.期待値)}`)
      落ちた++
    }
  }

  console.log('')
  console.log('本文（同じ数字が載っているかだけを見る。解析はしない）')
  let 欠けた = 0
  for (const r of 本文を見る(期待.検算)) {
    if (r.欠け.length) {
      console.log(`  NG   ${r.場所} に載っていない: ${r.欠け.join(' / ')}（${r.id}）`)
      欠けた++
    }
  }
  if (欠けた === 0) console.log('  OK   期待値の数字は全部、指した本文に載っている')

  console.log('')
  if (落ちた === 0 && 欠けた === 0) {
    console.log(`結果: 全件一致（件数 ${期待.検算.length} 種 ／ 本文の欠け 0）`)
    return 0
  }
  console.log(`結果: 不一致 ${落ちた} 件 ／ 本文に載っていない数字 ${欠けた} 件`)
  return 1
}

process.exit(主処理())
