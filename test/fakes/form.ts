// 偽のフォーム — src/build-form.test.ts と src/clear-for-next-year.test.ts が共有する 1 本。
//
// 以前は 2 本に別々に書かれていた（→ issue #301）。2 本の和集合を 1 本にしてある。
// ここは本物ではない。実機でしか分からないものは src/real-device-log.md が持つ。
//
//   本物と違う所
//   - 設問は種類（text／paragraph／radio／image）と、渡された題・必須・説明・検証・選択肢・画像を覚えるだけである。
//     見た目や並べ替えは持たない。
//   - 設問の検証（createTextValidation など）は、渡されたパターンと説明を持つ素の値にする。
//     本物のように回答を検めはしない。
//   - setDestination は、回答先のスプレッドシート（books[id]）に「フォームの回答 1」を 1 枚足し、1 行目に
//     「タイムスタンプ」と設問の題を並べる。本物は回答が来るまで列を足さないかもしれない（実機未確認）。
//   - 回答シートの getFormUrl が返すのは、フォームの「編集用」URL にしてある。
//     本物がどちらを返すかは確かめていない（→ src/real-device-log.md の項目 24）。
//   - URL はフォームごとに違う（番号が付く）。本物は ID を含む長い URL である。

/** createFormApp が作る FormApp の偽物が使う、フォームの番号。 */
let nextFormNumber = 1

import type { FakeSheet, FakeSpreadsheet } from './spreadsheet.ts'

export class FakeValidationBuilder {
  declare built: { kind: string, pattern?: string, helpText?: string }
  constructor(kind) { this.built = { kind } }
  requireTextMatchesPattern(pattern) { this.built.pattern = pattern; return this }
  setHelpText(text) { this.built.helpText = text; return this }
  build() { return this.built }
}

export class FakeItem {
  declare kind: string
  declare title: string | null
  declare required: boolean
  declare helpText: any
  declare validation: any
  declare choices: string[]
  declare image: unknown
  constructor(kind) { Object.assign(this, { kind, title: null, required: false, helpText: null, validation: null }) }
  setTitle(title) { this.title = title; return this }
  setRequired(required) { this.required = required; return this }
  setHelpText(text) { this.helpText = text; return this }
  setValidation(validation) { this.validation = validation; return this }
  setChoiceValues(choices) { this.choices = choices; return this }
  setImage(image) { this.image = image; return this }
}

export class FakeForm {
  declare title: string
  declare items: FakeItem[]
  declare destination: { type: string, id: string } | null
  declare books: Record<string, FakeSpreadsheet>
  declare number: number
  declare linkedSheet: FakeSheet | null
  /** books は、回答先に指せるスプレッドシートを ID で引ける組（setDestination が引く）。 */
  constructor(title: string, books: Record<string, FakeSpreadsheet>) {
    Object.assign(this, { title, items: [], destination: null, books, number: nextFormNumber++, linkedSheet: null })
  }
  add(kind) { const item = new FakeItem(kind); this.items.push(item); return item }
  addTextItem() { return this.add('text') }
  addParagraphTextItem() { return this.add('paragraph') }
  addMultipleChoiceItem() { return this.add('radio') }
  addImageItem() { return this.add('image') }
  getPublishedUrl() { return `https://forms.example/${this.number}/viewform` }
  getEditUrl() { return `https://forms.example/${this.number}/edit` }
  setDestination(type, id) {
    this.destination = { type, id }
    const book = this.books[id]
    if (!book) throw new Error(`偽のフォーム: 回答先 ${id} が無い`)
    const sheet = book.insertSheet('フォームの回答 1')
    const header = ['タイムスタンプ', ...this.items.filter((item) => item.kind !== 'image').map((item) => item.title)]
    sheet.getRange(1, 1, 1, header.length).setValues([header])
    sheet.formUrl = this.getEditUrl()
    this.linkedSheet = sheet
    return this
  }
  removeDestination() {
    if (this.linkedSheet) this.linkedSheet.formUrl = null
    this.linkedSheet = null
    return this
  }
}

/**
 * vm の文脈に置く FormApp の偽物と、作られたフォームの一覧を返す。
 * books は FakeForm に渡す、回答先の組。検査が book を足していく。
 */
export function createFormApp(books: Record<string, FakeSpreadsheet>) {
  const forms: FakeForm[] = []
  const FormApp = {
    DestinationType: { SPREADSHEET: 'SPREADSHEET' },
    create(title) { const form = new FakeForm(title, books); forms.push(form); return form },
    openByUrl(url) {
      const found = forms.filter((form) => form.getEditUrl() === url || form.getPublishedUrl() === url)[0]
      if (!found) throw new Error(`偽のフォーム: ${url} が無い`)
      return found
    },
    createTextValidation() { return new FakeValidationBuilder('text') },
    createParagraphTextValidation() { return new FakeValidationBuilder('paragraph') },
  }
  return { FormApp, forms }
}
