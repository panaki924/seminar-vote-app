import { describe, expect, it } from "vitest";
import {
  actionLabel,
  actionResultMessage,
  actionTone,
  advanceButton,
  canConfirmReset,
  formatWait,
  resetSummary,
  revealControls,
  statusLabel,
  voteProgress,
  type AdminAdvanceInfo,
} from "./admin-view";
import { ALL_ACTIONS } from "./admin-rules";

const advance = (over: Partial<AdminAdvanceInfo> = {}): AdminAdvanceInfo => ({
  willClose: true,
  closeName: "豊臣秀吉",
  nextMemberId: "K0003",
  nextName: "徳川家康",
  canAdvance: true,
  ...over,
});

describe("advanceButton(『締め切って次へ』のボタン)", () => {
  it("投票中の動画があり、次もあるとき:次の動画の名前つき", () => {
    expect(advanceButton(advance())).toEqual({ label: "締め切って次へ(次:徳川家康)", enabled: true });
  });

  it("投票中の動画があるが、次が無いとき:締切だけできる", () => {
    expect(advanceButton(advance({ nextMemberId: null, nextName: null }))).toEqual({
      label: "締め切る(次の未放映の動画はありません)",
      enabled: true,
    });
  });

  it("投票中の動画が無く、未放映があるとき:最初の動画を開始", () => {
    expect(advanceButton(advance({ willClose: false, closeName: null }))).toEqual({
      label: "最初の動画を開始(徳川家康)",
      enabled: true,
    });
  });

  it("どちらも無いとき:押せない", () => {
    expect(
      advanceButton(advance({ willClose: false, closeName: null, nextMemberId: null, nextName: null, canAdvance: false })),
    ).toEqual({ label: "開始できる動画がありません", enabled: false });
  });
});

describe("voteProgress(投票の進み具合)", () => {
  it("人数・割合・全員済みか", () => {
    expect(voteProgress(7, 9)).toEqual({ text: "投票済み 7 / 9 人", percent: 78, complete: false });
    expect(voteProgress(9, 9)).toEqual({ text: "投票済み 9 / 9 人", percent: 100, complete: true });
    expect(voteProgress(0, 9)).toEqual({ text: "投票済み 0 / 9 人", percent: 0, complete: false });
  });

  it("対象が0人でも、0 で割らない(全員済みとも言わない)", () => {
    expect(voteProgress(0, 0)).toEqual({ text: "投票済み 0 / 0 人", percent: 0, complete: false });
  });

  it("割合は 100% を超えない", () => {
    expect(voteProgress(12, 9).percent).toBe(100);
  });
});

describe("状態・操作の見せ方", () => {
  it("状態の表示名", () => {
    expect(statusLabel("pending")).toBe("未放映");
    expect(statusLabel("open")).toBe("投票中");
    expect(statusLabel("closed")).toBe("締切");
    expect(statusLabel("not_shown")).toBe("放映不可");
  });

  it("操作の表示名とボタンの種類(開始は目立たせ、放映できないは赤系)", () => {
    expect(ALL_ACTIONS.map(actionLabel)).toEqual(["開始", "締切", "再開", "放映できない", "元に戻す"]);
    expect(actionTone("start")).toBe("primary");
    expect(actionTone("skip")).toBe("danger");
    expect(actionTone("close")).toBe("neutral");
    expect(actionTone("reopen")).toBe("neutral");
    expect(actionTone("restore")).toBe("neutral");
  });

  it("操作が成功したときの文(動画の名前つき)", () => {
    expect(actionResultMessage("start", "豊臣秀吉")).toBe("「豊臣秀吉」を開始しました。");
    expect(actionResultMessage("close", "豊臣秀吉")).toBe("「豊臣秀吉」を締め切りました。");
    expect(actionResultMessage("reopen", "豊臣秀吉")).toContain("再開");
    expect(actionResultMessage("skip", "豊臣秀吉")).toContain("順位の対象から外れます");
    expect(actionResultMessage("restore", "豊臣秀吉")).toContain("未放映に戻しました");
  });
});

describe("revealControls(結果発表のボタン)", () => {
  it("段階0:進められる(3位を発表)。戻す・非表示は押せない", () => {
    const c = revealControls(0);
    expect(c.next).toEqual({ enabled: true, targetStage: 1, label: "3位を発表する" });
    expect(c.back.enabled).toBe(false);
    expect(c.hide.enabled).toBe(false);
  });

  it("段階1:次は2位まで。戻すと0、非表示は0", () => {
    const c = revealControls(1);
    expect(c.next).toEqual({ enabled: true, targetStage: 2, label: "2位まで発表する" });
    expect(c.back).toEqual({ enabled: true, targetStage: 0, label: "ひとつ戻す" });
    expect(c.hide).toEqual({ enabled: true, targetStage: 0, label: "非表示にする" });
  });

  it("段階2:次は1位まで。戻すと1", () => {
    const c = revealControls(2);
    expect(c.next).toEqual({ enabled: true, targetStage: 3, label: "1位まで発表する" });
    expect(c.back.targetStage).toBe(1);
  });

  it("段階3:もう進められない。戻すと2、非表示は0", () => {
    const c = revealControls(3);
    expect(c.next).toMatchObject({ enabled: false, targetStage: 3, label: "すべて発表済みです" });
    expect(c.back.targetStage).toBe(2);
    expect(c.hide.targetStage).toBe(0);
  });

  it("範囲外の値でも、0〜3 に収める", () => {
    expect(revealControls(-5).next.targetStage).toBe(1);
    expect(revealControls(99).next.enabled).toBe(false);
  });
});

describe("リセットの確認ダイアログ", () => {
  it("『リセット』と入力するまでは、実行できない", () => {
    expect(canConfirmReset("", false)).toBe(false);
    expect(canConfirmReset("リセ", false)).toBe(false);
    expect(canConfirmReset("reset", false)).toBe(false);
    expect(canConfirmReset("リセット", false)).toBe(true);
    expect(canConfirmReset("  リセット ", false)).toBe(true); // 前後の空白は許す
  });

  it("送信中は、合言葉が正しくても押せない(二重実行の防止)", () => {
    expect(canConfirmReset("リセット", true)).toBe(false);
  });

  it("何が起きるかの説明に、削除する投票の件数と、『元に戻せません』、名簿・QRコードは残ることが入る", () => {
    const lines = resetSummary({ votes: 42 });
    expect(lines[0]).toBe("投票 42 件を、すべて削除します。");
    expect(lines.join("\n")).toContain("未放映");
    expect(lines.join("\n")).toContain("非表示");
    expect(lines.join("\n")).toContain("そのまま使えます");
    expect(lines.at(-1)).toContain("元に戻せません");
  });
});

describe("formatWait(待ち時間の表示)", () => {
  it("60秒未満は秒、それ以上は『約N分』", () => {
    expect(formatWait(45)).toBe("45秒");
    expect(formatWait(59.2)).toBe("約1分"); // 秒は切り上げ(60秒)になり、60秒以上は分で表す
    expect(formatWait(60)).toBe("約1分");
    expect(formatWait(599)).toBe("約10分");
    expect(formatWait(600)).toBe("約10分");
    expect(formatWait(601)).toBe("約11分");
  });

  it("負の値は0秒", () => {
    expect(formatWait(-3)).toBe("0秒");
  });
});
