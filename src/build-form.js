/**
 * 定義から本番のフォームを作り、回答先をこのスプレッドシート自身に向ける（issue #144）。
 * 担当者がするのは、メニューを押して名簿の画像を選ぶことだけである。
 *
 * 定義は form-definition.js が持ち、ここは作り方だけを持つ。設問の題の日付と説明文の営業時間は、
 * 条件入力の「日ごとの営業時刻」から組む。
 *
 * 読めるものは、フォームを作る前に全部読む。作ってから止まると、作りかけのフォームが残る。
 * 掴むのは getActive のスプレッドシートと、ここで作るフォームだけである。
 */
/** 回答先を向ける先のシート（構成は sheet-layout.js）。 */
const answerSheetName = '回答'

/** 設問の題の日付と、説明文の営業時間の出どころ。 */
const businessHoursSectionName = '日ごとの営業時刻'

/** 担当者が選んだ画像を受け取る画面。メニュー「フォームを作る」の中身である。 */
function openRosterPicker() {
  const dialog = HtmlService.createHtmlOutputFromFile('form-picker')
    .setWidth(460)
    .setHeight(300)
  SpreadsheetApp.getUi().showModalDialog(dialog, '調理名簿の画像を選択')
}

/**
 * form-picker.html から呼ばれる入口。picked は { base64, mimeType, fileName }。
 * 返すのはフォームの URL と、やったことの記録である。
 */
function createFormFromPicker(picked) {
  const built = buildFormOn(SpreadsheetApp.getActive(), rosterImageFrom(picked))
  console.log(built.log.join('\n'))
  return built
}

/** 画面から渡ってきた画像を Blob に直す。選ばれていなければ名指しして止まる。 */
function rosterImageFrom(picked) {
  if (!picked || !picked.base64) {
    throw new Error('調理名簿の画像を選んでください')
  }
  return Utilities.newBlob(
    Utilities.base64Decode(picked.base64),
    picked.mimeType,
    picked.fileName,
  )
}

/**
 * 定義どおりのフォームを 1 つ作り、回答先をこのスプレッドシートに向け、
 * フォームが作った回答シートを構成の「回答」に繋ぐ。
 * フォームの名前はこのファイルの名前を使う（記録に前回のフォーム名が無いため）。
 */
function buildFormOn(spreadsheet, rosterImage) {
  const log = []
  const layout = answerSheetLayout()
  const templateSheet = spreadsheet.getSheetByName(layout.name)

  if (!templateSheet) {
    throw new Error(sheetNotFoundText(layout.name)) // → shell.js
  }
  if (templateSheet.getFormUrl()) {
    // 作り直さない。
    throw new Error(
      `このファイルにはもうフォームがあります（${templateSheet.getFormUrl()}）。`
        + '作り直すときは、テンプレートをコピーし直してください',
    )
  }
  if (templateSheet.getLastRow() > 1) {
    // 回答を消さない（黙って直さない）。
    throw new Error(
      `「${layout.name}」シートにすでに ${templateSheet.getLastRow() - 1} 行あるため、フォームを作れません`,
    )
  }

  // ここまでで止まれば、フォームは 1 つも作られていない。
  const days = readBusinessHours(spreadsheet)
  const items = formItemsFor(days)
  const expectedHeader = answerHeaderOf(layout, items)
  log.push(
    `設問の題と営業時間を「${businessHoursSectionName}」${days.length} 行から組んだ`
      + `（${items.filter((item) => item.label).map((item) => `${item.title} ${item.businessHours}`).join(' / ')}）`,
  )

  const form = FormApp.create(spreadsheet.getName())
  addFormItems(form, items, rosterImage, log)

  const sheetIdsBefore = spreadsheet.getSheets().map((sheet) => sheet.getSheetId())
  form.setDestination(FormApp.DestinationType.SPREADSHEET, spreadsheet.getId())
  SpreadsheetApp.flush()
  log.push(`回答先をこのスプレッドシート自身に向けた（${spreadsheet.getId()}）`)

  const urls = { published: form.getPublishedUrl(), edit: form.getEditUrl() }
  // 回答シートを繋ぐ前に書く。繋ぐところで止まっても、できたフォームの URL は残る。
  writeFormUrls(spreadsheet, urls, log)

  const created = spreadsheet
    .getSheets()
    .filter((sheet) => sheetIdsBefore.indexOf(sheet.getSheetId()) === -1)
  if (created.length !== 1) {
    throw internalError(
      `フォームが作った回答シートが ${created.length} 枚ある（1 枚のはず）。`
        + `いまあるシート: ${spreadsheet.getSheets().map((sheet) => sheet.getName()).join(' / ')}`,
    )
  }

  linkAnswerSheet(spreadsheet, templateSheet, created[0], layout, expectedHeader, log)

  return { url: urls.published, editUrl: urls.edit, log }
}

/**
 * 条件入力の URL 欄（C9 ／ C10）に、フォームの URL を書く（→ sheet-layout.js の formUrlBlock ／ issue #255）。
 * 完了画面を閉じた後も、ここから開ける。欄は保護の内にあるが「警告のみ」なので、スクリプトは書ける。
 */
function writeFormUrls(spreadsheet, urls, log) {
  const block = formUrlBlock
  const sheet = findSheet(spreadsheet, block.sheet) // → shell.js
  sheet.getRange(block.row, block.urlColumn, block.rows.length, 1).setValues(block.rows.map((one) => [urls[one.key]]))
  log.push(`フォームの URL を「${block.sheet}」の ${block.row}〜${block.row + block.rows.length - 1} 行目に書いた`)
}

/**
 * 条件入力の「日ごとの営業時刻」を読んで、型 #1（枠）に直す（→ input-types.js の toDays）。
 * 時刻の形式と順は toDays が、4 行であることは formItemsFor が見るので、ここでは足さない。
 */
function readBusinessHours(spreadsheet) {
  const layout = findLayout('条件入力')
  const section = layout.sections.filter((one) => one.heading === businessHoursSectionName)[0]
  if (!section) {
    throw internalError(`構成の「${layout.name}」に「${businessHoursSectionName}」の区画が無い`)
  }
  const sheet = findSheet(spreadsheet, layout.name)
  return toDays(readSection(sheet, layout, section), businessHoursSectionName)
}

/**
 * フォームが作る回答シートの見出し（タイムスタンプ ＋ 設問の題 9 つ）。
 * 構成が列名を持つのは前の 6 列だけで、後ろ 4 列は今年の日付から出る題である。
 * 前の 6 列が定義と食い違えば、フォームを作る前に止まる。
 */
function answerHeaderOf(layout, items) {
  const section = layout.sections[0]
  const header = [section.columns[0]].concat(
    items.filter((item) => item.kind !== formItemKind.image).map((item) => item.title),
  )

  if (header.length !== sectionWidth(section)) {
    throw internalError(
      `設問が ${header.length - 1} つで、構成の「${layout.name}」の ${sectionWidth(section) - 1} 列と数が違う`,
    )
  }
  const named = header.slice(0, section.columns.length)
  if (named.join('\t') !== section.columns.join('\t')) {
    throw internalError(
      `構成の「${layout.name}」の列名と、設問の題が食い違っている。`
        + `構成: ${section.columns.join(' / ')} ／ 設問: ${named.join(' / ')}`,
    )
  }
  return header
}

/** 定義の順にフォームへ置く。items は今年の日付と営業時刻を入れた定義（→ formItemsFor）。 */
function addFormItems(form, items, rosterImage, log) {
  items.forEach((item) => {
    if (item.kind === formItemKind.text) {
      const added = form.addTextItem().setTitle(item.title).setRequired(item.required)
      if (item.pattern) added.setValidation(textValidationOf(item))
      return
    }
    if (item.kind === formItemKind.radio) {
      form.addMultipleChoiceItem()
        .setTitle(item.title)
        .setChoiceValues(item.choices)
        .setRequired(item.required)
      return
    }
    if (item.kind === formItemKind.paragraph) {
      // 設問の setHelpText は説明文。エラーメッセージは検証の側の setHelpText である。
      form.addParagraphTextItem()
        .setTitle(item.title)
        .setHelpText(wishTimeDescription(item))
        .setRequired(item.required)
        .setValidation(paragraphValidationOf(item))
      return
    }
    if (item.kind === formItemKind.image) {
      form.addImageItem().setTitle(item.title).setImage(rosterImage)
      return
    }
    throw internalError(`形式「${item.kind}」の作り方を決めていない`)
  })

  const questions = items.filter((item) => item.kind !== formItemKind.image)
  const images = items.filter((item) => item.kind === formItemKind.image)
  log.push(`設問を ${questions.length} つ、画像アイテムを ${images.length} つ置いた`)
}

/** 短文回答の正規表現。エラーメッセージは定義が持つ設問にだけ置く（記録に無い文言を発明しない）。 */
function textValidationOf(item) {
  const builder = FormApp.createTextValidation().requireTextMatchesPattern(item.pattern)
  return (item.errorMessage ? builder.setHelpText(item.errorMessage) : builder).build()
}

/** 長文回答の正規表現と、そのエラーメッセージ（句点の揺れごと写す）。 */
function paragraphValidationOf(item) {
  return FormApp.createParagraphTextValidation()
    .requireTextMatchesPattern(item.pattern)
    .setHelpText(item.errorMessage)
    .build()
}

/**
 * フォームが作ったシート（名前は「フォームの回答 1」）を、構成の「回答」にする。
 * 空のテンプレートを消し、同じ名前・同じ位置に置き直す。名前を替えても紐付きは切れない。
 * 見出しは、いま置いた設問の題（→ answerHeaderOf）と位置で突き合わせる。
 */
function linkAnswerSheet(spreadsheet, templateSheet, responseSheet, layout, expectedHeader, log) {
  const header = responseSheet
    .getRange(1, 1, 1, expectedHeader.length)
    .getValues()[0]
    .map((cell) => String(cell))

  if (header.join('\t') !== expectedHeader.join('\t')) {
    throw internalError(
      'フォームが作った回答シートの見出しが、いま置いた設問の題と違う。'
        + `いま: ${header.join(' / ')} ／ 置いた題: ${expectedHeader.join(' / ')}。`
        + '繋がずに止まる（黙って直さない）',
    )
  }

  spreadsheet.deleteSheet(templateSheet)
  responseSheet.setName(layout.name)
  responseSheet.setFrozenRows(layout.frozenRows)
  spreadsheet.setActiveSheet(responseSheet)
  spreadsheet.moveActiveSheet(answerSheetPosition())
  applyProtection(responseSheet, layout, log)
  log.push(`フォームが作ったシートを「${layout.name}」にした`)
}

/** 構成の中の「回答」。 */
function answerSheetLayout() {
  const layout = sheetLayout.filter((one) => one.name === answerSheetName)[0]
  if (!layout) {
    throw internalError(`構成に「${answerSheetName}」が無い`)
  }
  return layout
}

/** 構成の並びの中で、回答が何枚目か。 */
function answerSheetPosition() {
  return sheetLayout.map((one) => one.name).indexOf(answerSheetName) + 1
}
