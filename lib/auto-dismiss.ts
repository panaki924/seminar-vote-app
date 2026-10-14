// 「一定時間たったら、お知らせを自動で消す」ための部品。React の useEffect の中身として使う。
// ・戻り値は「後始末の関数」。React は、お知らせが入れ替わったとき・画面が閉じられたときに、これを呼ぶ。
//   → 古いタイマーが残らず、閉じた画面に対して、あとから状態を変えようとすることもない。
// ・タイマーが鳴ったときに消すのは、「いま表示しているお知らせが、このタイマーを開始したときと同じもの」だけ。
//   (間に新しいお知らせに置き換わっていたら、新しい方を消してしまわない)
// 画面(React)には依存しないので、テストでは、偽のタイマーと偽の状態で確かめられる。

export function autoDismissEffect<T>(
  item: T | null,
  delayMs: number | null,
  setItem: (updater: (current: T | null) => T | null) => void,
): (() => void) | undefined {
  if (item === null || delayMs === null) return undefined; // お知らせが無い・自動で消さない種類のとき
  const timer = setTimeout(() => {
    setItem((current) => (current === item ? null : current));
  }, delayMs);
  return () => clearTimeout(timer);
}
