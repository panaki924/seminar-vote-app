import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { emptyDraft, type Draft, type Screen } from "../../../lib/vote-view";
import { ScreenView, type ScreenViewProps } from "./vote-views";

// 各画面が描く HTML を調べる(ブラウザは使わない)。
const video = (isOwn = false) => ({ videoId: "K0002", name: "豊臣秀吉", nameEn: "Toyotomi Hideyoshi", isOwn });
const sentVote = { tech: 3, impact: 4, updatedAt: "2026-10-22T01:23:00.000Z" };

function render(screen: Screen, over: Partial<ScreenViewProps> = {}) {
  const props: ScreenViewProps = {
    screen,
    draft: emptyDraft(),
    sending: false,
    canSubmitNow: false,
    hint: null,
    submitError: null,
    justSentTime: null,
    notice: null,
    connectionLost: false,
    onSelect: vi.fn(),
    onSubmit: vi.fn(),
    onStartEdit: vi.fn(),
    onCancelEdit: vi.fn(),
    onDismissNotice: vi.fn(),
    ...over,
  };
  return renderToStaticMarkup(<ScreenView {...props} />);
}

const count = (html: string, needle: string | RegExp) =>
  typeof needle === "string" ? html.split(needle).length - 1 : (html.match(needle) ?? []).length;

describe("投票欄(form)", () => {
  const form: Screen = { kind: "form", voterName: "織田信長", video: video(), mode: "new" };

  it("2項目×5段階=ラジオボタン10個。どれも選ばれていない(初期値なし)", () => {
    const html = render(form, { hint: "①と②の点数を選ぶと、送信できます" });
    expect(count(html, 'type="radio"')).toBe(10);
    expect(count(html, /checked=""/g)).toBe(0);
    expect(html).toContain("① 動画の技術的水準と完成度");
    expect(html).toContain("② 自己紹介としてのインパクト");
    expect(count(html, "未選択")).toBe(2);
  });

  it("2項目を選ぶまで、送信ボタンは無効で、案内文が出る", () => {
    const html = render(form, { canSubmitNow: false, hint: "①と②の点数を選ぶと、送信できます" });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>送信する<\/button>/);
    expect(html).toContain("①と②の点数を選ぶと、送信できます");
  });

  it("2項目を選ぶと、送信ボタンが有効になり、選んだ点数が選択済みで表示される", () => {
    const draft: Draft = { tech: 4, impact: 2 };
    const html = render(form, { draft, canSubmitNow: true });
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>送信する<\/button>/);
    expect(count(html, /checked=""/g)).toBe(2);
    expect(html).toContain("選択中:4 点");
    expect(html).toContain("選択中:2 点");
  });

  it("送信中はボタンに『送信中…』と出て、選択欄も無効になる", () => {
    const html = render(form, { draft: { tech: 4, impact: 2 }, sending: true, canSubmitNow: false });
    expect(html).toContain("送信中…");
    expect(count(html, /<fieldset[^>]*disabled=""/g)).toBe(2);
  });

  it("送信に失敗したときは、メッセージを role=alert で出す", () => {
    const html = render(form, { submitError: "通信できませんでした。" });
    expect(html).toContain('role="alert"');
    expect(html).toContain("通信できませんでした。");
  });

  it("変更用(edit)の投票欄:前の点数が選択済みで、『変更を送信する』と『変更をやめる』が出る", () => {
    const html = render(
      { ...form, mode: "edit" },
      { draft: { tech: 3, impact: 4 }, canSubmitNow: false, hint: "点数を変えると、送信できます" },
    );
    expect(count(html, /checked=""/g)).toBe(2);
    expect(html).toContain("評価を変更できます");
    expect(html).toContain("変更を送信する");
    expect(html).toContain("変更をやめる");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>変更を送信する<\/button>/); // 同じ内容のままでは送れない
  });

  it("新規の投票欄には『変更をやめる』は出ない", () => {
    expect(render(form)).not.toContain("変更をやめる");
  });
});

describe("自分の動画", () => {
  it("『あなたの動画です』と出て、投票欄(ラジオボタン・送信ボタン)は出ない", () => {
    const html = render({ kind: "own-video", voterName: "豊臣秀吉", video: video(true) });
    expect(html).toContain("あなたの動画です");
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain("送信する");
    expect(html).not.toContain("<fieldset");
  });
});

describe("送信済み(voted)", () => {
  const voted: Screen = { kind: "voted", voterName: "織田信長", video: video(), vote: sentVote };

  it("送信直後は『✓ 送信しました』を大きく出し、2つの点数を表示する", () => {
    const html = render(voted, { justSentTime: "10:23" });
    expect(html).toContain("✓ 送信しました");
    expect(html).toContain("10:23 に送信しました");
    expect(html).toMatch(/data-testid="score-tech">3</);
    expect(html).toMatch(/data-testid="score-impact">4</);
    expect(html).toContain("評価を変更する");
  });

  it("後から開いたとき(送信直後でない)は『送信済みです』と時刻、2つの点数を表示する", () => {
    const html = render(voted, { justSentTime: null });
    expect(html).not.toContain("✓ 送信しました");
    expect(html).toContain("送信済みです(10:23)");
    expect(html).toMatch(/data-testid="score-tech">3</);
    expect(html).toMatch(/data-testid="score-impact">4</);
  });

  it("送信済み画面には投票欄(ラジオボタン)が出ない", () => {
    expect(render(voted)).not.toContain('type="radio"');
  });
});

describe("その他の画面", () => {
  it("読み込み中", () => {
    expect(render({ kind: "loading" })).toContain("読み込み中…");
  });

  it("待機中:名前と、投票中の動画がない旨", () => {
    const html = render({ kind: "waiting", voterName: "織田信長" });
    expect(html).toContain("織田信長");
    expect(html).toContain("いま投票中の動画はありません");
  });

  it("本人確認できない:メッセージを role=alert で出し、『自動で更新』は出さない", () => {
    const html = render({ kind: "invalid-token", message: "QRコードを読み取り直してください。" });
    expect(html).toContain("本人確認できませんでした");
    expect(html).toContain("QRコードを読み取り直してください。");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("自動で更新");
  });

  it("通信が途切れているときは、お知らせを出す", () => {
    const html = render({ kind: "waiting", voterName: "織田信長" }, { connectionLost: true });
    expect(html).toContain("接続を確認しています");
  });

  it("動画が切り替わったお知らせと『閉じる』ボタンを出す", () => {
    const html = render(
      { kind: "form", voterName: "織田信長", video: video(), mode: "new" },
      { notice: "投票中の動画が「豊臣秀吉」に切り替わりました。" },
    );
    expect(html).toContain("切り替わりました");
    expect(html).toContain("閉じる");
  });
});
