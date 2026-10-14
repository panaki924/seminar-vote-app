import { describe, expect, it } from "vitest";
import type { VideoStatus } from "./ranking";
import {
  ALL_ACTIONS,
  allowedActions,
  applyVideoAction,
  compareRosterOrder,
  isResetConfirmed,
  isValidRevealStage,
  isVideoAction,
  pickNextVideo,
  REVEAL_STAGE_LABELS,
  revealWarnings,
  RESET_CONFIRM_PHRASE,
  sortByRoster,
  stepRevealStage,
  type VideoAction,
} from "./admin-rules";

const v = (memberId: string, status: VideoStatus) => ({ memberId, status });

// CLAUDE.md の名簿(放映順=学籍番号順)
const ROSTER = ["K0001", "K0002", "K0003", "K0004", "K0005", "K0006", "K0007", "K0008", "K0009", "S001"];
const allWith = (statuses: Partial<Record<string, VideoStatus>>) =>
  ROSTER.map((id) => v(id, statuses[id] ?? "pending"));

describe("動画の状態の切替表", () => {
  const expected: Record<VideoStatus, Partial<Record<VideoAction, VideoStatus>>> = {
    pending: { start: "open", skip: "not_shown" },
    open: { close: "closed", skip: "not_shown" },
    closed: { reopen: "open", skip: "not_shown" },
    not_shown: { restore: "pending" },
  };

  for (const status of Object.keys(expected) as VideoStatus[]) {
    for (const action of ALL_ACTIONS) {
      const want = expected[status][action] ?? null;
      it(`${status} に「${action}」→ ${want ?? "不可(null)"}`, () => {
        expect(applyVideoAction(status, action)).toBe(want);
      });
    }
  }

  it("いまの状態で行える操作の一覧(画面のボタンの出し分け)", () => {
    expect(allowedActions("pending")).toEqual(["start", "skip"]);
    expect(allowedActions("open")).toEqual(["close", "skip"]);
    expect(allowedActions("closed")).toEqual(["reopen", "skip"]);
    expect(allowedActions("not_shown")).toEqual(["restore"]);
  });

  it("放映不可の動画は、いきなり開始できない(先に『元に戻す』が要る)", () => {
    expect(applyVideoAction("not_shown", "start")).toBeNull();
    expect(applyVideoAction("not_shown", "reopen")).toBeNull();
  });

  it("操作名の判定", () => {
    expect(ALL_ACTIONS.every(isVideoAction)).toBe(true);
    for (const bad of ["open", "START", "", null, undefined, 1, {}]) expect(isVideoAction(bad)).toBe(false);
  });
});

describe("名簿の並び順(学籍番号順。S001 は最後)", () => {
  it("K0001〜K0009 のあとに S001 が来る", () => {
    expect(["S001", "K0009", "K0001", "K0005"].sort(compareRosterOrder)).toEqual(["K0001", "K0005", "K0009", "S001"]);
  });

  it("数字は、数として比べる(K0010 は K0009 の後。桁がそろっていなくても同じ)", () => {
    expect(["K0010", "K0009", "K0002", "K0100"].sort(compareRosterOrder)).toEqual(["K0002", "K0009", "K0010", "K0100"]);
    expect(["K10", "K9", "K2"].sort(compareRosterOrder)).toEqual(["K2", "K9", "K10"]);
  });

  it("文字の部分は、大文字小文字を区別しない", () => {
    expect(compareRosterOrder("k0001", "K0002")).toBeLessThan(0);
    expect(compareRosterOrder("s001", "K0009")).toBeGreaterThan(0);
  });

  it("同じ ID は 0", () => {
    expect(compareRosterOrder("K0001", "K0001")).toBe(0);
  });

  it("sortByRoster:順序を変えた入力でも、名簿順に並べる(元の配列は変えない)", () => {
    const shuffled = [v("S001", "pending"), v("K0003", "pending"), v("K0001", "pending")];
    expect(sortByRoster(shuffled).map((x) => x.memberId)).toEqual(["K0001", "K0003", "S001"]);
    expect(shuffled.map((x) => x.memberId)).toEqual(["S001", "K0003", "K0001"]);
  });
});

describe("pickNextVideo(「締め切って次へ」で開く動画)", () => {
  it("名簿順で、いまの動画の次の pending を選ぶ", () => {
    expect(pickNextVideo(allWith({ K0003: "closed", K0001: "closed", K0002: "closed" }), "K0003")).toBe("K0004");
  });

  it("not_shown は飛ばす", () => {
    const videos = allWith({ K0003: "closed", K0004: "not_shown", K0005: "not_shown" });
    expect(pickNextVideo(videos, "K0003")).toBe("K0006");
  });

  it("closed と open も飛ばす(pending だけを選ぶ)", () => {
    const videos = allWith({ K0003: "closed", K0004: "closed", K0005: "open" });
    expect(pickNextVideo(videos, "K0003")).toBe("K0006");
  });

  it("K0009 の次は S001(S001 は最後)。入力の並びが逆でも同じ", () => {
    const videos = allWith({ K0009: "closed" });
    expect(pickNextVideo(videos, "K0009")).toBe("S001");
    expect(pickNextVideo([...videos].reverse(), "K0009")).toBe("S001");
  });

  it("途中の動画が not_shown でも、S001 まで飛んで選ぶ", () => {
    const videos = allWith({ K0008: "closed", K0009: "not_shown" });
    expect(pickNextVideo(videos, "K0008")).toBe("S001");
  });

  it("S001 の次は無い(null)", () => {
    expect(pickNextVideo(allWith({ S001: "closed" }), "S001")).toBeNull();
  });

  it("後ろに pending が1つも無ければ null(前の方の pending には戻らない)", () => {
    const videos = allWith({ K0005: "closed", K0006: "closed", K0007: "closed", K0008: "closed", K0009: "closed", S001: "not_shown" });
    expect(pickNextVideo(videos, "K0005")).toBeNull();
  });

  it("いまの動画より前にある pending は選ばない(順序を戻さない)", () => {
    // K0001 が未放映のまま K0003 から始めた場合、K0003 の次は K0004
    expect(pickNextVideo(allWith({ K0003: "closed" }), "K0003")).toBe("K0004");
  });

  it("投票中の動画が無い(null)ときは、名簿順で最初の pending", () => {
    expect(pickNextVideo(allWith({}), null)).toBe("K0001");
    expect(pickNextVideo(allWith({ K0001: "not_shown", K0002: "closed" }), null)).toBe("K0003");
  });

  it("いまの動画が一覧に無いときは、先頭から探す", () => {
    expect(pickNextVideo(allWith({ K0001: "closed" }), "K9999")).toBe("K0002");
  });

  it("全部が pending でなければ null", () => {
    expect(pickNextVideo(ROSTER.map((id) => v(id, "closed")), null)).toBeNull();
    expect(pickNextVideo([], null)).toBeNull();
  });
});

describe("結果発表の段階", () => {
  it("0〜3 の整数だけが正しい段階", () => {
    for (const n of [0, 1, 2, 3]) expect(isValidRevealStage(n)).toBe(true);
    for (const bad of [-1, 4, 1.5, "1", null, undefined, NaN]) expect(isValidRevealStage(bad)).toBe(false);
  });

  it("1つ進める・戻す。0〜3 の外には出ない", () => {
    expect(stepRevealStage(0, 1)).toBe(1);
    expect(stepRevealStage(2, 1)).toBe(3);
    expect(stepRevealStage(3, 1)).toBe(3);
    expect(stepRevealStage(1, -1)).toBe(0);
    expect(stepRevealStage(0, -1)).toBe(0);
  });

  it("段階の表示名が4つある", () => {
    expect(REVEAL_STAGE_LABELS).toEqual(["非表示", "3位を公開中", "2位まで公開中", "1位まで公開中"]);
  });
});

describe("発表前の警告", () => {
  const closedAll = ROSTER.map((id) => v(id, "closed"));

  it("段階 0(非表示にする)のときは、警告しない", () => {
    expect(revealWarnings({ videos: allWith({}), rankedCount: 0, targetStage: 0 })).toEqual([]);
  });

  it("締切前(pending か open)の動画が残っていると、本数つきで警告する", () => {
    const videos = allWith({ K0001: "closed", K0002: "open" }); // pending 8本 + open 1本 = 9本
    const w = revealWarnings({ videos, rankedCount: 5, targetStage: 1 });
    expect(w.map((x) => x.code)).toEqual(["unfinished-videos"]);
    expect(w[0].message).toContain("9 本");
  });

  it("not_shown と closed は、締切前に数えない", () => {
    const videos = allWith({ K0001: "closed", K0002: "not_shown" });
    const mostlyClosed = videos.map((x) => (x.status === "pending" ? { ...x, status: "closed" as const } : x));
    expect(revealWarnings({ videos: mostlyClosed, rankedCount: 5, targetStage: 1 })).toEqual([]);
  });

  it("順位の対象が3名未満だと警告する(人数つき)", () => {
    const w = revealWarnings({ videos: closedAll, rankedCount: 2, targetStage: 3 });
    expect(w.map((x) => x.code)).toEqual(["few-ranked"]);
    expect(w[0].message).toContain("2 名");
  });

  it("両方に当てはまれば、2つ警告する", () => {
    const w = revealWarnings({ videos: allWith({}), rankedCount: 0, targetStage: 2 });
    expect(w.map((x) => x.code)).toEqual(["unfinished-videos", "few-ranked"]);
  });

  it("全部締切で、3名以上が順位に入るなら、警告なし", () => {
    expect(revealWarnings({ videos: closedAll, rankedCount: 9, targetStage: 3 })).toEqual([]);
  });
});

describe("リセットの確認語", () => {
  it("『リセット』だけが通る(前後の空白は許す)", () => {
    expect(RESET_CONFIRM_PHRASE).toBe("リセット");
    expect(isResetConfirmed("リセット")).toBe(true);
    expect(isResetConfirmed("  リセット\n")).toBe(true);
  });

  it.each(["", "reset", "RESET", "リセット!", "リセ ット", "ﾘｾｯﾄ", "リセットする", null, undefined, 1, {}, ["リセット"]])(
    "%j は通らない",
    (bad) => {
      expect(isResetConfirmed(bad)).toBe(false);
    },
  );
});
