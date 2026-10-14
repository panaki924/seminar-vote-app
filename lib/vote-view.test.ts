import { describe, expect, it } from "vitest";
import {
  canSubmit,
  deriveScreen,
  draftForVideo,
  draftFromVote,
  emptyDraft,
  formatSentTime,
  isDraftComplete,
  setScore,
  submitHint,
  toScore,
  videoSwitched,
  type VoteSnapshot,
} from "./vote-view";

const video = (isOwn = false) => ({ videoId: "K0002", name: "豊臣秀吉", nameEn: "Toyotomi Hideyoshi", isOwn });
const voter = { id: "K0001", name: "織田信長" };
const vote = { tech: 3, impact: 4, updatedAt: "2026-10-22T01:23:00.000Z" };
const snap = (over: Partial<VoteSnapshot> = {}): VoteSnapshot => ({
  voter,
  current: video(),
  myVote: null,
  ...over,
});
const derive = (snapshot: VoteSnapshot | null, opts: { fatal?: string | null; editing?: boolean } = {}) =>
  deriveScreen({ snapshot, fatalMessage: opts.fatal ?? null, editing: opts.editing ?? false });

describe("deriveScreen(いま、どの画面を出すか)", () => {
  it("まだ取得できていなければ読み込み中", () => {
    expect(derive(null)).toEqual({ kind: "loading" });
  });

  it("本人確認できなかったときは、エラー画面が最優先(取得済みの状態があっても)", () => {
    expect(derive(snap(), { fatal: "本人確認できませんでした" })).toEqual({
      kind: "invalid-token",
      message: "本人確認できませんでした",
    });
    expect(derive(null, { fatal: "x" }).kind).toBe("invalid-token");
  });

  it("投票中の動画が無ければ待機画面(投票者の名前つき)", () => {
    expect(derive(snap({ current: null }))).toEqual({ kind: "waiting", voterName: "織田信長" });
  });

  it("自分の動画なら『あなたの動画です』の画面で、投票欄(form)は出さない", () => {
    expect(derive(snap({ current: video(true) })).kind).toBe("own-video");
    // 送信済みの内容があっても、変更中でも、自分の動画では投票欄を出さない
    expect(derive(snap({ current: video(true), myVote: vote }), { editing: true }).kind).toBe("own-video");
  });

  it("他人の動画で未送信なら、新規の投票欄", () => {
    expect(derive(snap())).toMatchObject({ kind: "form", mode: "new", voterName: "織田信長" });
  });

  it("送信済みなら送信済み画面(内容つき)", () => {
    expect(derive(snap({ myVote: vote }))).toMatchObject({ kind: "voted", vote });
  });

  it("送信済みで『変更する』を開いているときは、変更用の投票欄", () => {
    expect(derive(snap({ myVote: vote }), { editing: true })).toMatchObject({ kind: "form", mode: "edit" });
  });

  it("未送信のとき editing が true でも、新規の投票欄のまま", () => {
    expect(derive(snap(), { editing: true })).toMatchObject({ kind: "form", mode: "new" });
  });
});

describe("下書き(点数の入力)", () => {
  it("最初は何も選ばれていない(初期値なし)", () => {
    expect(emptyDraft()).toEqual({ tech: null, impact: null });
    expect(isDraftComplete(emptyDraft())).toBe(false);
  });

  it("1つだけ選んでも未完了、2つ選ぶと完了", () => {
    const tech = setScore(emptyDraft(), "tech", 4);
    expect(tech).toEqual({ tech: 4, impact: null });
    expect(isDraftComplete(tech)).toBe(false);
    const both = setScore(tech, "impact", 2);
    expect(both).toEqual({ tech: 4, impact: 2 });
    expect(isDraftComplete(both)).toBe(true);
  });

  it("選び直すと、その項目だけ変わる(元の下書きは変更しない)", () => {
    const first = setScore(setScore(emptyDraft(), "tech", 4), "impact", 2);
    const second = setScore(first, "tech", 5);
    expect(second).toEqual({ tech: 5, impact: 2 });
    expect(first).toEqual({ tech: 4, impact: 2 });
  });

  it.each([0, 6, -1, 3.5, NaN])("1〜5以外(%s)を選ぼうとすると例外", (bad) => {
    expect(() => setScore(emptyDraft(), "tech", bad)).toThrow(RangeError);
  });

  it("toScore は1〜5の整数だけ通す", () => {
    expect([1, 5].map(toScore)).toEqual([1, 5]);
    for (const bad of [0, 6, 2.5, "3", null, undefined, true]) expect(toScore(bad)).toBeNull();
  });

  it("送信済みの内容から、前の点数を選んだ状態の下書きを作る(送信済みが無ければ空)", () => {
    expect(draftFromVote(vote)).toEqual({ tech: 3, impact: 4 });
    expect(draftFromVote(null)).toEqual(emptyDraft());
  });
});

describe("canSubmit(送信ボタンを押せるか)", () => {
  const complete = { tech: 3, impact: 4 } as const;

  it("2項目とも選ぶまでは押せない", () => {
    expect(canSubmit(emptyDraft(), null, false)).toBe(false);
    expect(canSubmit({ tech: 3, impact: null }, null, false)).toBe(false);
    expect(canSubmit({ tech: null, impact: 3 }, null, false)).toBe(false);
  });

  it("2項目とも選べば押せる(新規)", () => {
    expect(canSubmit(complete, null, false)).toBe(true);
  });

  it("送信中は押せない(二重送信の防止)", () => {
    expect(canSubmit(complete, null, true)).toBe(false);
  });

  it("送信済みの内容と同じなら押せない。変えれば押せる", () => {
    expect(canSubmit(complete, vote, false)).toBe(false);
    expect(canSubmit({ tech: 5, impact: 4 }, vote, false)).toBe(true);
    expect(canSubmit({ tech: 3, impact: 1 }, vote, false)).toBe(true);
  });

  it("変更中に片方だけ選び直した(もう片方は前の点数)状態でも押せる", () => {
    expect(canSubmit({ ...draftFromVote(vote), impact: 1 }, vote, false)).toBe(true);
  });
});

describe("submitHint(送信ボタンの案内文)", () => {
  it("何も選んでいなければ、①と②を促す", () => {
    expect(submitHint(emptyDraft(), null, false)).toContain("①と②");
  });
  it("片方だけ選んでいれば、足りない方を促す", () => {
    expect(submitHint({ tech: 3, impact: null }, null, false)).toContain("②");
    expect(submitHint({ tech: null, impact: 3 }, null, false)).toContain("①");
  });
  it("押せるときは案内なし(null)", () => {
    expect(submitHint({ tech: 3, impact: 4 }, null, false)).toBeNull();
  });
  it("送信済みと同じ内容なら、点数を変えるよう促す", () => {
    expect(submitHint({ tech: 3, impact: 4 }, vote, false)).toContain("変える");
  });
  it("送信中は、その旨を出す", () => {
    expect(submitHint({ tech: 3, impact: 4 }, null, true)).toContain("送信しています");
  });
});

describe("動画の切り替わり", () => {
  it("どちらも動画があり、IDが違うときだけ『切り替わった』", () => {
    expect(videoSwitched("K0002", "K0003")).toBe(true);
    expect(videoSwitched("K0002", "K0002")).toBe(false);
    expect(videoSwitched(null, "K0002")).toBe(false); // 最初の取得
    expect(videoSwitched("K0002", null)).toBe(false); // 締切(動画なし)
    expect(videoSwitched(null, null)).toBe(false);
  });

  it("動画が同じなら、入力中の下書きをポーリングで消さない", () => {
    const draft = { tech: 4 as const, impact: null };
    expect(draftForVideo(draft, "K0002", "K0002")).toBe(draft);
  });

  it("動画が切り替わったら下書きを空に戻す", () => {
    expect(draftForVideo({ tech: 4, impact: 2 }, "K0002", "K0003")).toEqual(emptyDraft());
  });

  it("投票中の動画が無くなったら(締切)、下書きを空に戻す", () => {
    expect(draftForVideo({ tech: 4, impact: 2 }, "K0002", null)).toEqual(emptyDraft());
  });

  it("下書きがどの動画のものか分からない(null)ときは空にする", () => {
    expect(draftForVideo({ tech: 4, impact: 2 }, null, "K0002")).toEqual(emptyDraft());
  });
});

describe("formatSentTime", () => {
  it("UTC の時刻を日本時間の『時:分』にする", () => {
    expect(formatSentTime("2026-10-22T01:23:00.000Z")).toBe("10:23");
    expect(formatSentTime("2026-10-22T15:05:00.000Z")).toBe("00:05"); // 日本時間では翌日の0時台
  });

  it("読み取れない文字列は空文字", () => {
    expect(formatSentTime("not a date")).toBe("");
    expect(formatSentTime("")).toBe("");
  });
});
