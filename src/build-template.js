/**
 * テンプレートを 1 つ作る（docs/tech-requirements.md 8 の 1）。
 *
 * 走らせるのはテンプレートを用意する側（実装者）である。1 回だけ走らせて、
 * 出来上がったスプレッドシートを担当者にコピーさせる。
 * 担当者のメニュー（menu.js）には出さない — 担当者の操作は
 * 2「担当者がやることの全部」の 10 行だけで、そこにこの操作は無い。
 *
 * 黙って直さない。黙って走らない。
 * すでにあるシートの見出しが構成と違えば、名指しで止まる（上書きしない）。
 */

/** Apps Script のエディタから手で走らせる入口。 */
function テンプレートを組み立てる() {
  const 記録 = 組み立てる(SpreadsheetApp.getActive())
  console.log(記録.join('\n'))
  return 記録.join('\n')
}

/**
 * シートの構成どおりにシートを作り、見出しを置き、生成シートに保護をかける。
 * 何度走らせても同じ形になる（足りないものだけ足す）。
 */
function 組み立てる(スプレッドシート) {
  const 記録 = []

  シートの構成.forEach((構成, 並び) => {
    let シート = スプレッドシート.getSheetByName(構成.名前)
    if (!シート) {
      シート = スプレッドシート.insertSheet(構成.名前)
      記録.push(`シート「${構成.名前}」を作った`)
    }
    見出しを置く(シート, 構成, 記録)
    シート.setFrozenRows(構成.凍結行)
    スプレッドシート.setActiveSheet(シート)
    スプレッドシート.moveActiveSheet(並び + 1)
    保護を合わせる(シート, 構成, 記録)
  })

  既定のシートを片づける(スプレッドシート, 記録)
  スプレッドシート.setActiveSheet(スプレッドシート.getSheetByName(シートの構成[0].名前))
  記録.push(`5 枚のうち保護したのは ${シートの構成.filter((c) => c.保護する).length} 枚である`)
  return 記録
}

/** 区画ごとに、見出しの行と列名の行を置く。中身が違うときは上書きせずに止まる。 */
function 見出しを置く(シート, 構成, 記録) {
  const 列名の行 = 構成.区画の見出しを置くか ? 2 : 1

  構成.区画.forEach((区画) => {
    if (構成.区画の見出しを置くか) {
      置き換える(シート, 1, 区画.開始列, [区画.見出し], 構成.名前, 記録)
      シート.getRange(1, 区画.開始列).setFontWeight('bold').setNote(区画.注記)
    }
    置き換える(シート, 列名の行, 区画.開始列, 区画.列, 構成.名前, 記録)
    const 見出しの範囲 = シート.getRange(列名の行, 区画.開始列, 1, 区画.列.length)
    見出しの範囲.setFontWeight('bold')
    if (!構成.区画の見出しを置くか) {
      シート.getRange(列名の行, 区画.開始列).setNote(区画.注記)
    }
  })
}

/** 空なら書く。同じなら何もしない。違うなら名指しで止まる。 */
function 置き換える(シート, 行, 開始列, 値, シート名, 記録) {
  const 範囲 = シート.getRange(行, 開始列, 1, 値.length)
  const いま = 範囲.getValues()[0].map((セル) => String(セル))
  const これから = 値.map((セル) => String(セル))

  if (いま.join('\t') === これから.join('\t')) return
  if (いま.every((セル) => セル === '')) {
    範囲.setValues([これから])
    記録.push(`「${シート名}」の ${行} 行目 ${開始列} 列目から見出しを置いた`)
    return
  }
  throw new Error(
    `「${シート名}」の ${行} 行目 ${開始列} 列目が構成と違う。`
      + `いま: ${いま.join(' / ')} ／ 構成: ${これから.join(' / ')}。`
      + '中身を見てから決める（黙って直さない）',
  )
}

/**
 * 生成シートに保護をかける。
 * 保護は「警告のみ」である — コピーしたファイルの持ち主は担当者自身で、
 * 持ち主を締め出せる保護は Google スプレッドシートに無い（→ src/README.md）。
 */
function 保護を合わせる(シート, 構成, 記録) {
  シート
    .getProtections(SpreadsheetApp.ProtectionType.SHEET)
    .forEach((すでにある保護) => すでにある保護.remove())

  if (!構成.保護する) return

  シート.protect().setDescription(保護の説明).setWarningOnly(true)
  記録.push(`シート「${構成.名前}」に保護をかけた（警告のみ）`)
}

/** 新しいスプレッドシートに最初からある空のシートを消す。中身があれば残して名指しする。 */
function 既定のシートを片づける(スプレッドシート, 記録) {
  const 構成の名前 = シートの構成.map((構成) => 構成.名前)

  スプレッドシート.getSheets().forEach((シート) => {
    const 名前 = シート.getName()
    if (構成の名前.indexOf(名前) !== -1) return

    if (シート.getLastRow() === 0 && シート.getLastColumn() === 0) {
      スプレッドシート.deleteSheet(シート)
      記録.push(`空のシート「${名前}」を消した`)
      return
    }
    記録.push(`構成に無いシート「${名前}」に中身があるので、残した`)
  })
}
