import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autoDismissEffect } from "./auto-dismiss";
import { feedbackAutoDismissMs, SUCCESS_AUTO_DISMISS_MS } from "./admin-view";

// 偽のタイマー(テストの中で、時間を好きなだけ進められる)と、偽の「画面の状態」で確かめる。
// React の useEffect は、「お知らせが入れ替わったとき・画面が閉じられたとき」に、戻り値(後始末の関数)を呼ぶ。
// ここでも、その呼ばれ方を再現して確かめる。
type Notice = { message: string };

function makeState(initial: Notice | null) {
  const box = { current: initial };
  const setItem = vi.fn((updater: (current: Notice | null) => Notice | null) => {
    box.current = updater(box.current);
  });
  return { box, setItem };
}

describe("autoDismissEffect(お知らせの自動消去)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("お知らせが無い・自動で消さない種類のときは、タイマーを作らない", () => {
    const { setItem } = makeState(null);
    expect(autoDismissEffect<Notice>(null, 5000, setItem)).toBeUndefined();
    expect(autoDismissEffect({ message: "x" }, null, setItem)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("指定した時間(5秒)がたつまでは消えず、たつと消える", () => {
    const notice = { message: "成功" };
    const { box, setItem } = makeState(notice);
    autoDismissEffect(notice, SUCCESS_AUTO_DISMISS_MS, setItem);

    vi.advanceTimersByTime(4999);
    expect(box.current).toBe(notice); // まだ表示している
    expect(setItem).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(box.current).toBeNull(); // ちょうど5秒で消える
    expect(vi.getTimerCount()).toBe(0);
  });

  it("後始末(画面が閉じられた・お知らせが入れ替わった)をすると、タイマーが止まり、あとから状態を変えない", () => {
    const notice = { message: "成功" };
    const { box, setItem } = makeState(notice);
    const cleanup = autoDismissEffect(notice, 5000, setItem)!;
    expect(typeof cleanup).toBe("function");
    expect(vi.getTimerCount()).toBe(1);

    cleanup(); // 画面が閉じられたことを再現
    expect(vi.getTimerCount()).toBe(0); // タイマーが残っていない

    vi.advanceTimersByTime(60_000);
    expect(setItem).not.toHaveBeenCalled(); // 閉じたあとに、状態を変えようとしない
    expect(box.current).toBe(notice);
  });

  it("後始末は、何度呼んでも安全", () => {
    const notice = { message: "成功" };
    const { setItem } = makeState(notice);
    const cleanup = autoDismissEffect(notice, 5000, setItem)!;
    cleanup();
    expect(() => cleanup()).not.toThrow();
  });

  it("タイマーが鳴ったあとの後始末も、安全(消したあとに呼ばれても何も起きない)", () => {
    const notice = { message: "成功" };
    const { box, setItem } = makeState(notice);
    const cleanup = autoDismissEffect(notice, 5000, setItem)!;
    vi.advanceTimersByTime(5000);
    expect(box.current).toBeNull();
    expect(() => cleanup()).not.toThrow();
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it("お知らせが新しいものに置き換わったら、古いタイマーは止まり、新しいお知らせは、そこから5秒表示される", () => {
    const first = { message: "1つ目" };
    const second = { message: "2つ目" };
    const state = makeState(first);

    const cleanupFirst = autoDismissEffect(first, 5000, state.setItem)!;
    vi.advanceTimersByTime(3000); // 1つ目を3秒表示したところで…

    // …次の操作で、新しいお知らせに置き換わる(React は、先に古い後始末を呼び、新しい効果を始める)
    cleanupFirst();
    state.box.current = second;
    autoDismissEffect(second, 5000, state.setItem);

    vi.advanceTimersByTime(2000); // 1つ目のタイマーが、そのまま動いていたら、ここで鳴るはずの時刻
    expect(state.box.current).toBe(second); // 2つ目は、消えていない

    vi.advanceTimersByTime(2999);
    expect(state.box.current).toBe(second); // 2つ目の表示から 4999ms
    vi.advanceTimersByTime(1);
    expect(state.box.current).toBeNull(); // 2つ目は、自分の5秒で消える
  });

  it("万一、古いタイマーが残って鳴っても、いま表示している別のお知らせは消さない(同じ物のときだけ消す)", () => {
    const first = { message: "1つ目" };
    const second = { message: "2つ目" };
    const state = makeState(first);
    autoDismissEffect(first, 5000, state.setItem); // 後始末を呼ばずに、置き換える(あり得ない場合の保険の確認)
    state.box.current = second;

    vi.advanceTimersByTime(5000);
    expect(state.box.current).toBe(second);
  });

  it("成功のお知らせは5秒、失敗・注意(警告つき)は自動では消えない", () => {
    expect(feedbackAutoDismissMs("success")).toBe(5000);
    expect(feedbackAutoDismissMs("error")).toBeNull();
    expect(feedbackAutoDismissMs("info")).toBeNull();
  });

  it("失敗・注意のお知らせでは、タイマーが作られず、いつまでも残る", () => {
    const notice = { message: "失敗" };
    const { box, setItem } = makeState(notice);
    expect(autoDismissEffect(notice, feedbackAutoDismissMs("error"), setItem)).toBeUndefined();
    vi.advanceTimersByTime(600_000);
    expect(box.current).toBe(notice);
  });

  it("成功のお知らせを、5秒で消す流れを通しで確かめる(種類から時間を決めて、時間がたつと消える)", () => {
    const notice = { message: "「豊臣秀吉」を締め切りました。" };
    const { box, setItem } = makeState(notice);
    autoDismissEffect(notice, feedbackAutoDismissMs("success"), setItem);
    vi.advanceTimersByTime(5000);
    expect(box.current).toBeNull();
  });
});
