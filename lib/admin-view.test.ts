import { describe, expect, it } from "vitest";
import {
  actionLabel,
  actionResultMessage,
  actionTone,
  advanceButton,
  canConfirmReset,
  formatWait,
  lockNotice,
  namesShownAfterStatus,
  notVotedDisplay,
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

describe("notVotedDisplay(まだ投票していない人の見せ方)", () => {
  const names = ["徳川家康", "伊達政宗"];

  it("非表示のとき:人数だけで、名前は含まれない", () => {
    const d = notVotedDisplay(names, false);
    expect(d).toEqual({ text: "まだ投票していない人:2 人(名前は非表示)", canToggle: true, toggleLabel: "名前を表示する" });
    expect(d.text).not.toContain("徳川家康");
  });

  it("表示のとき:名前を「、」でつなぐ。切替の文言は『名前を隠す』", () => {
    expect(notVotedDisplay(names, true)).toEqual({
      text: "まだ投票していない人:徳川家康、伊達政宗",
      canToggle: true,
      toggleLabel: "名前を隠す",
    });
  });

  it("全員が投票済みなら、切替は不要(表示・非表示のどちらでも同じ)", () => {
    for (const shown of [true, false]) {
      expect(notVotedDisplay([], shown)).toEqual({ text: "全員が投票済みです。", canToggle: false, toggleLabel: "" });
    }
  });
});

describe("lockNotice(ログインが止められているときの案内。残り時間は1か所だけ)", () => {
  const ipMessage = "ログインの失敗が続いたため、しばらく受け付けられません。約 9 分後に、もう一度お試しください。";
  const globalMessage =
    "短い間にログインの失敗が多かったため、安全のため、ログインを一時的に止めています。約 10 分後に、もう一度お試しください。";
  // 残り時間(「約N分」「N秒」)の表記が、いくつ入っているか
  const timeMentions = (text: string) => (text.match(/(約\s*\d+\s*分|\d+\s*秒)/g) ?? []).length;

  it("サーバーの文の『約 N 分後に、もう一度お試しください。』を取り除き、残り時間を、1か所だけに入れる(IP ごとの停止)", () => {
    const text = lockNotice(ipMessage, 540);
    expect(text).toBe("ログインの失敗が続いたため、しばらく受け付けられません。 あと約9分ほど、お待ちください。");
    expect(timeMentions(text)).toBe(1);
    expect(text).not.toContain("もう一度お試しください");
  });

  it("全体の停止の文でも、同じ(残り時間は1か所だけ)", () => {
    const text = lockNotice(globalMessage, 600);
    expect(text).toContain("ログインを一時的に止めています。");
    expect(text).toContain("あと約10分ほど、お待ちください。");
    expect(timeMentions(text)).toBe(1);
  });

  it("残り時間が減ると、案内文の中の時間だけが変わる(60秒未満は『N秒』)", () => {
    expect(lockNotice(ipMessage, 125)).toContain("あと約3分ほど");
    expect(lockNotice(ipMessage, 59)).toContain("あと59秒ほど");
    expect(timeMentions(lockNotice(ipMessage, 59))).toBe(1);
    expect(lockNotice(ipMessage, 1)).toContain("あと1秒ほど");
  });

  it("サーバーの文に『約 N 分後に』が無いときも、残り時間を1か所だけ足す", () => {
    const text = lockNotice("ログインを止めています。", 300);
    expect(text).toBe("ログインを止めています。 あと約5分ほど、お待ちください。");
    expect(timeMentions(text)).toBe(1);
  });

  it("サーバーの文が、残り時間の文だけのときは、理由なしで残り時間だけを出す", () => {
    expect(lockNotice("約 9 分後に、もう一度お試しください。", 540)).toBe("あと約9分ほど、お待ちください。");
  });

  it("半角・全角の空白や、句点の有無が違っても取り除ける", () => {
    expect(lockNotice("止めています。約9分後にもう一度お試しください", 540)).toBe("止めています。 あと約9分ほど、お待ちください。");
  });
});

describe("namesShownAfterStatus(名前の表示を、動画が変わったら非表示に戻す)", () => {
  it("同じ動画が投票中のままなら、表示の記憶を残す", () => {
    expect(namesShownAfterStatus("K0002", "K0002", "K0002")).toBe("K0002");
    expect(namesShownAfterStatus(null, "K0002", "K0002")).toBeNull();
  });

  it("別の動画に変わったら、記憶を消す(非表示に戻る)", () => {
    expect(namesShownAfterStatus("K0002", "K0002", "K0003")).toBeNull();
  });

  it("投票中の動画がなくなったら(締切・リセット)、記憶を消す", () => {
    expect(namesShownAfterStatus("K0002", "K0002", null)).toBeNull();
  });

  it("【見つけた不具合の再現】K0002 で表示 → 投票中でなくなる → K0002 がまた投票中になっても、名前は勝手に出ない", () => {
    let shown: string | null = "K0002";
    let previous: string | null = "K0002";
    for (const next of [null, "K0002"] as const) {
      shown = namesShownAfterStatus(shown, previous, next);
      previous = next;
    }
    expect(shown).toBeNull();
  });

  it("【同じ】K0002 → K0003 → K0002 と変わっても、戻ったときは非表示", () => {
    let shown: string | null = "K0002";
    let previous: string | null = "K0002";
    for (const next of ["K0003", "K0002"] as const) {
      shown = namesShownAfterStatus(shown, previous, next);
      previous = next;
    }
    expect(shown).toBeNull();
  });

  it("最初の取得(前回は投票中なし)で、投票中の動画が見つかっても、表示の記憶は無いまま", () => {
    expect(namesShownAfterStatus(null, null, "K0002")).toBeNull();
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
