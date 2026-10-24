// 型だけを読む。サーバー側の関数が返す値の形（import type は変換で消える）。
import type { BuiltForm } from '../core/types.ts'

var button = document.getElementById('run') as HTMLButtonElement
var state = document.getElementById('state') as HTMLElement

function say(text: string, stopped?: boolean) {
  state.textContent = text
  state.className = stopped ? 'stopped' : 'note'
}

button.addEventListener('click', function () {
  var file = (document.getElementById('picked') as HTMLInputElement).files![0]
  if (!file) {
    say('画像を選んでください。', true)
    return
  }

  button.disabled = true
  say('画像を読み込み中…')

  var reader = new FileReader()
  reader.onerror = function () {
    button.disabled = false
    say('画像を読み込めませんでした。別の画像で試してください。', true)
  }
  reader.onload = function () {
    // data:image/png;base64,xxxx の後ろだけを渡す。
    var base64 = String(reader.result).split(',')[1]
    say('フォーム作成中…（30 秒〜1 分ほどかかります）')
    google.script.run
      .withSuccessHandler(done)
      .withFailureHandler(function (error) {
        button.disabled = false
        say('フォームを作成できませんでした：' + error.message, true)
      })
      .createFormFromPicker({
        base64: base64,
        mimeType: file.type,
        fileName: file.name,
      })
  }
  reader.readAsDataURL(file)
})

// やったことの記録は createFormFromPicker が実行ログに出しているので、ここには出さない。
function done(built: BuiltForm) {
  link('url', built.url)
  link('editUrl', built.editUrl)
  ;(document.getElementById('picker') as HTMLElement).hidden = true
  ;(document.getElementById('built') as HTMLElement).hidden = false
}

function link(id: string, url: string) {
  var a = document.getElementById(id) as HTMLAnchorElement
  a.href = url
  a.textContent = url
}
