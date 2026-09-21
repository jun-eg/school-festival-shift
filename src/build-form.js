/**
 * 定義から本番のフォームを作り、回答先をこのスプレッドシート自身に向ける
 * （docs/tech-requirements.md 8 の 5 ／ 6 の #6 ／ issue #144）。
 *
 * 担当者に要求するのは、メニューを押すことと、委員会から来た名簿の画像を選ぶことだけである
 * （→ 2 の一覧 3）。フォーム作成そのもの（作る側 ACTION 4「時間がかかる ◎」）も、
 * 回答先スプレッドシートの紐付けも要求しない。
 *
 * 定義は form-definition.js が持つ（→ 4-1〜4-3）。ここは作り方だけである。
 * 設問の並び・正規表現・エラーメッセージの文言をここで足さない・揃えない。
 *
 * 黙って直さない。黙って走らない。
 *   すでにフォームが紐付いていれば、作り直さずに名指しして止まる
 *   回答シートに行があれば、消さずに名指しして止まる
 *   フォームが作った回答シートの見出しが構成と違えば、繋がずに名指しして止まる
 *
 * 掴むのは、このスクリプトが入っているスプレッドシート（getActive）と、
 * ここで作る 1 つのフォームだけである。他人のファイルを openById で開かない（→ src/README.md のスコープ）。
 */

/** 回答先を向ける先のシート。構成は sheet-layout.js が持つ（→ 8 の 1）。 */
const answerSheetName = '回答'

/** 担当者が選んだ画像を受け取る画面。メニュー「フォームを作る」の中身である。 */
function openRosterPicker() {
  const dialog = HtmlService.createHtmlOutputFromFile('form-picker')
    .setWidth(460)
    .setHeight(300)
  SpreadsheetApp.getUi().showModalDialog(dialog, '名簿の画像を選ぶ')
}

/**
 * 画面から呼ばれる入口（form-picker.html の google.script.run）。
 * picked は { base64, mimeType, fileName } で、担当者が選んだ画像そのものである。
 * 返すのは画面に出す値だけ（フォームの URL と、やったことの記録）である。
 */
function createFormFromPicker(picked) {
  const built = buildFormOn(SpreadsheetApp.getActive(), rosterImageFrom(picked))
  console.log(built.log.join('\n'))
  return built
}

/** 画面から渡ってきた画像を Blob に直す。選ばれていなければ名指しして止まる。 */
function rosterImageFrom(picked) {
  if (!picked || !picked.base64) {
    throw new Error('名簿の画像が選ばれていない。委員会から来た画像を選んでから押す（→ 2 の一覧 3）')
  }
  return Utilities.newBlob(
    Utilities.base64Decode(picked.base64),
    picked.mimeType,
    picked.fileName,
  )
}

/**
 * 定義どおりのフォームを 1 つ作り、回答先をこのスプレッドシート自身に向け、
 * フォームが作った回答シートを構成の「回答」に繋ぐ。
 *
 * フォームの名前は、担当者が付けたこのファイルの名前をそのまま使う。
 * 記録に前回のフォームの名前が無い（→ 4-1 の表は設問と画像アイテムだけを持つ）ので、
 * ここで新しい文言を発明しない。担当者に名前を入力させることもしない（→ 2 の一覧 3）。
 */
function buildFormOn(spreadsheet, rosterImage) {
  const log = []
  const layout = answerSheetLayout()
  const templateSheet = spreadsheet.getSheetByName(layout.name)

  if (!templateSheet) {
    throw new Error(
      `シート「${layout.name}」が無い。テンプレートを組み立て直す（→ src/README.md）`,
    )
  }
  if (templateSheet.getFormUrl()) {
    throw new Error(
      `シート「${layout.name}」にはすでにフォームが紐付いている（${templateSheet.getFormUrl()}）。`
        + 'フォームは 1 シーズンに 1 回作るもので、希望が増えても作り直さない（→ 5 の #11）。'
        + '作り直すなら、テンプレートをコピーし直すところからである（→ 6 の #1 の理由 ⑤）',
    )
  }
  if (templateSheet.getLastRow() > 1) {
    throw new Error(
      `シート「${layout.name}」に ${templateSheet.getLastRow() - 1} 行の中身がある。`
        + '回答を消してフォームを作り直さない（黙って直さない）。中身を見てから決める',
    )
  }

  const form = FormApp.create(spreadsheet.getName())
  addFormItems(form, rosterImage, log)

  const sheetIdsBefore = spreadsheet.getSheets().map((sheet) => sheet.getSheetId())
  form.setDestination(FormApp.DestinationType.SPREADSHEET, spreadsheet.getId())
  SpreadsheetApp.flush()
  log.push(`回答先をこのスプレッドシート自身に向けた（${spreadsheet.getId()}）`)

  const created = spreadsheet
    .getSheets()
    .filter((sheet) => sheetIdsBefore.indexOf(sheet.getSheetId()) === -1)
  if (created.length !== 1) {
    throw new Error(
      `フォームが作った回答シートが ${created.length} 枚だった（1 枚のはずである）。`
        + `いまあるシート: ${spreadsheet.getSheets().map((sheet) => sheet.getName()).join(' / ')}`,
    )
  }

  linkAnswerSheet(spreadsheet, templateSheet, created[0], layout, log)

  return { url: form.getPublishedUrl(), editUrl: form.getEditUrl(), log }
}

/** 定義の順にフォームへ置く。形式ごとの作り方はここだけが持つ。 */
function addFormItems(form, rosterImage, log) {
  formItems.forEach((item) => {
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
      // 設問の setHelpText は説明文である（→ 4-2 の例 ◎ と営業時間 ◎）。
      // エラーメッセージのほうは、検証の側の setHelpText である（→ 4-3・下の paragraphValidationOf）。
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
    throw new Error(`形式「${item.kind}」の作り方を決めていない（→ form-definition.js）`)
  })

  const questions = formItems.filter((item) => item.kind !== formItemKind.image)
  const images = formItems.filter((item) => item.kind === formItemKind.image)
  log.push(`設問を ${questions.length} つ、画像アイテムを ${images.length} つ置いた`)
}

/**
 * 短文回答の正規表現。
 * エラーメッセージの文言が記録にあるのは希望時間 4 設問だけである（→ 4-3）ので、
 * 無い設問には文言を置かない（無いものを発明しない）。
 */
function textValidationOf(item) {
  const builder = FormApp.createTextValidation().requireTextMatchesPattern(item.pattern)
  return (item.errorMessage ? builder.setHelpText(item.errorMessage) : builder).build()
}

/** 長文回答の正規表現と、そのエラーメッセージ（→ 4-2・4-3。句点の揺れ ◎ ごと写す）。 */
function paragraphValidationOf(item) {
  return FormApp.createParagraphTextValidation()
    .requireTextMatchesPattern(item.pattern)
    .setHelpText(item.errorMessage)
    .build()
}

/**
 * フォームが作ったシートを、構成の「回答」にする。
 *
 * setDestination で作られるシートの名前は Google が決める（「フォームの回答 1」）。
 * 構成は 5 枚で、回答はその 2 枚目である（→ 8 の 1・sheet-layout.js）ので、
 * 空のテンプレートのほうを消して、フォームが作ったシートを同じ名前・同じ位置に置き直す。
 * 名前だけ替えても紐付きは切れない — 回答はこのシートに積まれ続ける。
 */
function linkAnswerSheet(spreadsheet, templateSheet, responseSheet, layout, log) {
  const columns = layout.sections[0].columns
  const header = responseSheet
    .getRange(1, 1, 1, columns.length)
    .getValues()[0]
    .map((cell) => String(cell))

  if (header.join('\t') !== columns.join('\t')) {
    throw new Error(
      'フォームが作った回答シートの見出しが構成と違う。'
        + `いま: ${header.join(' / ')} ／ 構成: ${columns.join(' / ')}。`
        + '繋がずに止まる（黙って直さない）。定義（→ 4-1）と構成（→ sheet-layout.js）を見てから決める',
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

/** 構成の中の「回答」。sheet-layout.js が原本である。 */
function answerSheetLayout() {
  const layout = sheetLayout.filter((one) => one.name === answerSheetName)[0]
  if (!layout) {
    throw new Error(`構成に「${answerSheetName}」が無い（→ sheet-layout.js）`)
  }
  return layout
}

/** 構成の並びの中で、回答が何枚目か（→ build-template.js と同じ並べ方である）。 */
function answerSheetPosition() {
  return sheetLayout.map((one) => one.name).indexOf(answerSheetName) + 1
}
