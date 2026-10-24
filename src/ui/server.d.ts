// google.script.run が呼ぶ、サーバー側（Apps Script）の関数の型。
//
// 名前と引数は src/entry.ts の一覧のうち「HTML から google.script.run で呼ばれる」2 つである。
// 名前の打ち間違いは entry.test ① が entry 一覧との突き合わせで止める。@types/google.script.client-side の PublicEndpoints に
// 添字型があるので、tsc は名前を止めない。ここで効くのは引数の型だけである。
// 戻り値は成功ハンドラ（withSuccessHandler）に渡るので、呼んだ側は受け取らない。

declare namespace google.script {
  interface PublicEndpoints {
    /** 配る画像の中身を組む（→ src/shell/menu.ts の exportImagesFromDialog）。成功ハンドラに DistributionImage[] が渡る。 */
    exportImagesFromDialog(): void
    /** 選んだ画像でフォームを作る（→ src/shell/build-form.ts の createFormFromPicker）。成功ハンドラに BuiltForm が渡る。 */
    createFormFromPicker(picked: { base64: string; mimeType: string; fileName: string }): void
  }
}
