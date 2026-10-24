// 型だけを読む。ダイアログに渡る値の形はコアが決めている（import type は変換で消える）。
import type { Drawing, DistributionImage } from '../core/distribution-image.ts'

var state = document.getElementById('state') as HTMLElement
var saveAll = document.getElementById('saveAll') as HTMLButtonElement
var list = document.getElementById('images') as HTMLElement
var links: HTMLAnchorElement[] = []

function say(text: string, stopped?: boolean) {
  state.textContent = text
  state.className = stopped ? 'stopped' : 'note'
}

// 図形の一覧を canvas に塗る。寸法は px で来るので、scale 倍して画素を増やす。
function paint(drawing: Drawing): string {
  var canvas = document.createElement('canvas')
  canvas.width = drawing.width * drawing.scale
  canvas.height = drawing.height * drawing.scale
  var ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  ctx.scale(drawing.scale, drawing.scale)

  drawing.boxes.forEach(function (box) {
    ctx.fillStyle = box.fill
    ctx.fillRect(box.x, box.y, box.w, box.h)
  })

  ctx.strokeStyle = drawing.colors.line
  ctx.lineWidth = 1
  ctx.beginPath()
  drawing.lines.forEach(function (line) {
    ctx.moveTo(line.x1, line.y1)
    ctx.lineTo(line.x2, line.y2)
  })
  ctx.stroke()

  ctx.fillStyle = drawing.colors.text
  ctx.textBaseline = 'middle'
  drawing.texts.forEach(function (text) {
    ctx.font = (text.bold ? 'bold ' : '') + text.size + 'px sans-serif'
    ctx.textAlign = text.align
    // 端末の字体で溢れる分は、maxWidth で詰めて収める。
    ctx.fillText(text.text, text.x, text.y, text.maxWidth)
  })

  return canvas.toDataURL('image/png')
}

function show(images: DistributionImage[]) {
  var drawn = 0
  images.forEach(function (image) {
    var section = document.createElement('section')
    var heading = document.createElement('h2')
    heading.textContent = image.label
    section.appendChild(heading)

    if (!image.drawing) {
      const empty = document.createElement('p')
      empty.className = 'note'
      empty.textContent = 'この日はシフトが入っていないため、画像はありません。'
      section.appendChild(empty)
      list.appendChild(section)
      return
    }

    var url = paint(image.drawing)
    var link = document.createElement('a')
    link.href = url
    link.download = image.fileName
    link.textContent = '保存（' + image.fileName + '）'
    var picture = document.createElement('img')
    picture.src = url
    picture.alt = image.title
    section.appendChild(link)
    section.appendChild(picture)
    list.appendChild(section)
    links.push(link)
    drawn++
  })

  say(drawn + ' 枚の画像を作成しました。保存して LINE ノートに貼ってください。' + '保存が始まらないときは、画像を右クリック（スマホは長押し）で保存できます。')
  if (drawn > 1) {
    saveAll.textContent = drawn + ' 枚まとめて保存'
    saveAll.hidden = false
  }
}

saveAll.addEventListener('click', function () {
  links.forEach(function (link, index) {
    setTimeout(function () {
      link.click()
    }, index * 400)
  })
})

google.script.run
  .withSuccessHandler(show)
  .withFailureHandler(function (error) {
    say('画像を作成できませんでした：' + error.message, true)
  })
  .exportImagesFromDialog()
