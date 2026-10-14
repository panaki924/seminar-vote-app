import { describe, expect, it, vi } from "vitest";
import type { VideoStatus } from "./ranking";
import {
  changeRevealStage,
  changeVideoStatus,
  getAdminStatus,
  resetEverything,
  type AdminRepo,
  type AdminVoteRow,
  type SetStatusOutcome,
} from "./admin-service";

// ---------- テスト用の偽物の DB(本物の Supabase には接続しない) ----------
const ROSTER = [
  ["K0001", "織田信長", "Oda Nobunaga"],
  ["K0002", "豊臣秀吉", "Toyotomi Hideyoshi"],
  ["K0003", "徳川家康", "Tokugawa Ieyasu"],
  ["K0004", "伊達政宗", "Date Masamune"],
  ["K0005", "武田信玄", "Takeda Shingen"],
  ["K0006", "上杉謙信", "Uesugi Kenshin"],
  ["K0007", "毛利元就", "Mori Motonari"],
  ["K0008", "長曾我部元親", "Chosokabe Motochika"],
  ["K0009", "島津義弘", "Shimazu Yoshihiro"],
  ["S001", "豊臣秀長", "Toyotomi Hidenaga"],
] as const;

type Options = {
  statuses?: Partial<Record<string, VideoStatus>>;
  votes?: AdminVoteRow[];
  revealStage?: number;
  /** 状態の変更の結果を、強制的に変える(競合のテスト用) */
  forceOutcome?: (call: number, memberId: string) => SetStatusOutcome | undefined;
};

function makeRepo(options: Options = {}) {
  const statuses: Record<string, VideoStatus> = {};
  for (const [id] of ROSTER) statuses[id] = options.statuses?.[id] ?? "pending";
  let votes = [...(options.votes ?? [])];
  let revealStage = options.revealStage ?? 0;
  let setCalls = 0;

  const repo = {
    listVideos: vi.fn(async () =>
      // わざと順序をばらばらにして返す(名簿順に並べ直せているかの確認)
      [...ROSTER].reverse().map(([id, name, nameEn]) => ({ memberId: id, name, nameEn, status: statuses[id] })),
    ),
    listMembers: vi.fn(async () => ROSTER.map(([id, name]) => ({ id, name }))),
    listVotes: vi.fn(async () => votes),
    getRevealStage: vi.fn(async () => revealStage),
    setVideoStatus: vi.fn(async (memberId: string, from: VideoStatus, to: VideoStatus): Promise<SetStatusOutcome> => {
      setCalls += 1;
      const forced = options.forceOutcome?.(setCalls, memberId);
      if (forced) return forced;
      if (statuses[memberId] !== from) return "stale";
      // DB の部分ユニークインデックス(open は同時に1本)と同じ動き
      if (to === "open" && Object.entries(statuses).some(([id, s]) => id !== memberId && s === "open")) return "conflict-open";
      statuses[memberId] = to;
      return "ok";
    }),
    setRevealStage: vi.fn(async (stage: number) => {
      revealStage = stage;
    }),
    resetAll: vi.fn(async () => {
      revealStage = 0;
      for (const id of Object.keys(statuses)) statuses[id] = "pending";
      const deletedVotes = votes.length;
      votes = [];
      return { deletedVotes };
    }),
  } satisfies AdminRepo;
  return { repo, statuses, getVotes: () => votes, getRevealStage: () => revealStage };
}

const vote = (voterId: string, targetId: string, tech = 3, impact = 3): AdminVoteRow => ({ voterId, targetId, tech, impact });
const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

// ---------- いまの状態 ----------
describe("getAdminStatus", () => {
  it("動画を、名簿順(S001 は最後)に並べて返す", async () => {
    const { repo } = makeRepo();
    const result = await getAdminStatus(repo);
    expect(result.status).toBe(200);
    const ids = (result.body.videos as { memberId: string }[]).map((v) => v.memberId);
    expect(ids).toEqual(ROSTER.map(([id]) => id));
    expect(ids.at(-1)).toBe("S001");
  });

  it("投票中の動画の、投票済み人数・対象人数・まだ投票していない人の名前(投票の内容は出さない)", async () => {
    const { repo } = makeRepo({
      statuses: { K0002: "open" },
      votes: [vote("K0001", "K0002", 5, 1), vote("K0003", "K0002", 4, 2), vote("K0001", "K0005")],
    });
    const result = await getAdminStatus(repo);
    const open = result.body.open as Record<string, unknown>;
    expect(open).toMatchObject({ memberId: "K0002", name: "豊臣秀吉", voteCount: 2, eligibleCount: 9 });
    // 投票していない人 = 持ち主(K0002)と、投票済み(K0001・K0003)を除く7人。名簿順
    expect(open.notVotedNames).toEqual(["伊達政宗", "武田信玄", "上杉謙信", "毛利元就", "長曾我部元親", "島津義弘", "豊臣秀長"]);
    // 点数(個別の投票内容)は、どこにも出ない
    const text = JSON.stringify(result.body);
    expect(text).not.toContain('"tech"');
    expect(text).not.toContain('"impact"');
  });

  it("返事に、トークンも、個別の投票者と点数の組み合わせも含まれない", async () => {
    const { repo } = makeRepo({ statuses: { K0002: "open" }, votes: [vote("K0001", "K0002", 5, 1)] });
    const text = JSON.stringify((await getAdminStatus(repo)).body);
    expect(text).not.toMatch(/token/i);
    expect(text).not.toContain("voterId");
  });

  it("投票中の動画が無ければ、open は null", async () => {
    const { repo } = makeRepo();
    expect((await getAdminStatus(repo)).body.open).toBeNull();
  });

  it("各動画の操作ボタン:状態に応じて出し分け、ほかの動画が投票中なら『開始』『再開』を押せなくして理由を添える", async () => {
    const { repo } = makeRepo({ statuses: { K0002: "open", K0003: "closed", K0004: "not_shown" } });
    const videos = (await getAdminStatus(repo)).body.videos as { memberId: string; actions: { action: string; enabled: boolean; reason: string | null }[] }[];
    const by = (id: string) => videos.find((v) => v.memberId === id)!;
    // 投票中の動画自身:締切・放映できない(どちらも押せる)
    expect(by("K0002").actions).toEqual([
      { action: "close", enabled: true, reason: null },
      { action: "skip", enabled: true, reason: null },
    ]);
    // 未放映の動画:開始は、ほかが投票中なので押せない
    expect(by("K0001").actions[0]).toEqual({ action: "start", enabled: false, reason: "先に「豊臣秀吉」を締め切ってください" });
    expect(by("K0001").actions[1]).toEqual({ action: "skip", enabled: true, reason: null });
    // 締切の動画:再開も押せない
    expect(by("K0003").actions[0]).toMatchObject({ action: "reopen", enabled: false });
    // 放映不可:元に戻すは押せる
    expect(by("K0004").actions).toEqual([{ action: "restore", enabled: true, reason: null }]);
  });

  it("投票中の動画が無いときは、『開始』は押せる", async () => {
    const { repo } = makeRepo();
    const videos = (await getAdminStatus(repo)).body.videos as { memberId: string; actions: { action: string; enabled: boolean }[] }[];
    expect(videos[0].actions[0]).toMatchObject({ action: "start", enabled: true });
  });

  it("『締め切って次へ』の案内:いまの動画の名前と、名簿順で次の未放映の動画(放映不可は飛ばす)", async () => {
    const { repo } = makeRepo({ statuses: { K0003: "open", K0001: "closed", K0002: "closed", K0004: "not_shown" } });
    const advance = (await getAdminStatus(repo)).body.advance;
    expect(advance).toEqual({ willClose: true, closeName: "徳川家康", nextMemberId: "K0005", nextName: "武田信玄", canAdvance: true });
  });

  it("投票中の動画が無いときの案内:最初の未放映の動画を開始する", async () => {
    const { repo } = makeRepo({ statuses: { K0001: "closed" } });
    expect((await getAdminStatus(repo)).body.advance).toEqual({ willClose: false, closeName: null, nextMemberId: "K0002", nextName: "豊臣秀吉", canAdvance: true });
  });

  it("次が無い(S001 が投票中)ときは、締切だけできる", async () => {
    const { repo } = makeRepo({ statuses: { S001: "open" } });
    expect((await getAdminStatus(repo)).body.advance).toMatchObject({ willClose: true, nextMemberId: null, canAdvance: true });
  });

  it("発表段階と、次に進むときの警告(締切前の動画・順位の対象の少なさ)", async () => {
    const { repo } = makeRepo({ statuses: { K0001: "closed" }, revealStage: 1, votes: [vote("K0002", "K0001")] });
    const body = (await getAdminStatus(repo)).body;
    expect(body).toMatchObject({ revealStage: 1, revealLabel: "3位を公開中", rankedCount: 1 });
    expect((body.warnings as { code: string }[]).map((w) => w.code)).toEqual(["unfinished-videos", "few-ranked"]);
  });

  it("合計の人数・票数", async () => {
    const { repo } = makeRepo({ votes: [vote("K0001", "K0002"), vote("K0003", "K0002")] });
    expect((await getAdminStatus(repo)).body.totals).toEqual({ members: 10, votes: 2 });
  });

  it("DB のエラーは、中身を見せずに 500 の日本語メッセージにする", async () => {
    const { repo } = makeRepo();
    repo.listVotes.mockRejectedValueOnce(new Error("SECRET-DB-DETAIL relation xyz"));
    quiet();
    const result = await getAdminStatus(repo);
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain("SECRET-DB-DETAIL");
    expect(String(result.body.error)).toContain("もう一度");
  });
});

// ---------- 動画の状態の切替 ----------
describe("changeVideoStatus", () => {
  it("開始:pending → open", async () => {
    const { repo, statuses } = makeRepo();
    const result = await changeVideoStatus(repo, { memberId: "K0002", action: "start" });
    expect(result).toEqual({ status: 200, body: { ok: true, memberId: "K0002", status: "open" } });
    expect(statuses.K0002).toBe("open");
  });

  it("締切:open → closed、再開:closed → open", async () => {
    const { repo, statuses } = makeRepo({ statuses: { K0002: "open" } });
    expect((await changeVideoStatus(repo, { memberId: "K0002", action: "close" })).status).toBe(200);
    expect(statuses.K0002).toBe("closed");
    expect((await changeVideoStatus(repo, { memberId: "K0002", action: "reopen" })).status).toBe(200);
    expect(statuses.K0002).toBe("open");
  });

  it("放映できない → 元に戻す", async () => {
    const { repo, statuses } = makeRepo();
    expect((await changeVideoStatus(repo, { memberId: "K0003", action: "skip" })).status).toBe(200);
    expect(statuses.K0003).toBe("not_shown");
    expect((await changeVideoStatus(repo, { memberId: "K0003", action: "restore" })).status).toBe(200);
    expect(statuses.K0003).toBe("pending");
  });

  it("open は同時に1本だけ:ほかの動画が投票中なら、409 で断り、先に締め切る動画の名前を教える(DB は変えない)", async () => {
    const { repo, statuses } = makeRepo({ statuses: { K0002: "open" } });
    const result = await changeVideoStatus(repo, { memberId: "K0003", action: "start" });
    expect(result.status).toBe(409);
    expect(String(result.body.error)).toContain("豊臣秀吉");
    expect(String(result.body.error)).toContain("締め切ってください");
    expect(repo.setVideoStatus).not.toHaveBeenCalled();
    expect(statuses.K0003).toBe("pending");
  });

  it("再開も同じ:ほかの動画が投票中なら断る", async () => {
    const { repo } = makeRepo({ statuses: { K0002: "open", K0003: "closed" } });
    expect((await changeVideoStatus(repo, { memberId: "K0003", action: "reopen" })).status).toBe(409);
    expect(repo.setVideoStatus).not.toHaveBeenCalled();
  });

  it("確認と保存の間に、ほかで open になった(DB の制約が止めた)ときも、409 で日本語の案内にする", async () => {
    const { repo } = makeRepo({ forceOutcome: () => "conflict-open" });
    const result = await changeVideoStatus(repo, { memberId: "K0002", action: "start" });
    expect(result.status).toBe(409);
    expect(String(result.body.error)).toContain("投票中");
  });

  it("読んだあとに状態が変わっていた(stale)ときは、409 で、画面を更新するよう案内する", async () => {
    const { repo } = makeRepo({ forceOutcome: () => "stale" });
    const result = await changeVideoStatus(repo, { memberId: "K0002", action: "start" });
    expect(result.status).toBe(409);
    expect(String(result.body.error)).toContain("画面を更新");
  });

  it("許されない切替(放映不可をいきなり開始など)は 409。今の状態の名前つき", async () => {
    const { repo } = makeRepo({ statuses: { K0004: "not_shown" } });
    const result = await changeVideoStatus(repo, { memberId: "K0004", action: "start" });
    expect(result.status).toBe(409);
    expect(String(result.body.error)).toContain("放映不可");
    expect(repo.setVideoStatus).not.toHaveBeenCalled();
  });

  it("存在しない動画は 404", async () => {
    const { repo } = makeRepo();
    expect((await changeVideoStatus(repo, { memberId: "K9999", action: "start" })).status).toBe(404);
  });

  it.each([
    ["本文が無い", undefined],
    ["配列", []],
    ["文字列", "start"],
    ["操作が無い", { memberId: "K0002" }],
    ["未知の操作", { memberId: "K0002", action: "delete" }],
    ["動画の指定が無い", { action: "start" }],
    ["動画の指定が文字列でない", { memberId: 2, action: "start" }],
    ["動画の指定が空", { memberId: "", action: "start" }],
    ["動画の指定が長すぎる", { memberId: "K".repeat(100), action: "start" }],
  ])("不正な送信内容(%s)は 400 で、DB に触れない", async (_label, body) => {
    const { repo } = makeRepo();
    expect((await changeVideoStatus(repo, body)).status).toBe(400);
    expect(repo.listVideos).not.toHaveBeenCalled();
    expect(repo.setVideoStatus).not.toHaveBeenCalled();
  });

  it("DB のエラーは、中身を見せずに 500", async () => {
    const { repo } = makeRepo();
    repo.setVideoStatus.mockRejectedValueOnce(new Error("SECRET-DB-DETAIL"));
    quiet();
    const result = await changeVideoStatus(repo, { memberId: "K0002", action: "start" });
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain("SECRET-DB-DETAIL");
  });
});

describe("changeVideoStatus:締め切って次へ(advance)", () => {
  it("いまの動画を締め切り、名簿順で次の未放映の動画を開く", async () => {
    const { repo, statuses } = makeRepo({ statuses: { K0001: "closed", K0002: "open" } });
    const result = await changeVideoStatus(repo, { action: "advance" });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, closed: "K0002", opened: "K0003" });
    expect(statuses).toMatchObject({ K0002: "closed", K0003: "open" });
    // 順序:先に締切、そのあとで開始(open が2本になる瞬間が無い)
    expect(repo.setVideoStatus.mock.calls.map((c) => [c[0], c[2]])).toEqual([["K0002", "closed"], ["K0003", "open"]]);
  });

  it("放映不可は飛ばす", async () => {
    const { repo, statuses } = makeRepo({ statuses: { K0003: "open", K0004: "not_shown", K0005: "not_shown" } });
    const result = await changeVideoStatus(repo, { action: "advance" });
    expect(result.body).toMatchObject({ closed: "K0003", opened: "K0006" });
    expect(statuses.K0006).toBe("open");
    expect(statuses.K0004).toBe("not_shown");
  });

  it("K0009 の次は S001(S001 は最後)", async () => {
    const { repo, statuses } = makeRepo({ statuses: { K0009: "open" } });
    expect((await changeVideoStatus(repo, { action: "advance" })).body).toMatchObject({ closed: "K0009", opened: "S001" });
    expect(statuses.S001).toBe("open");
  });

  it("全部の動画を、名簿順に1本ずつ流せる(K0001 → … → K0009 → S001。放映不可は飛ばす)", async () => {
    const { repo, statuses } = makeRepo({ statuses: { K0005: "not_shown" } });
    const opened: string[] = [];
    for (let i = 0; i < 12; i++) {
      const result = await changeVideoStatus(repo, { action: "advance" });
      if (result.status !== 200 || result.body.opened === null) break;
      opened.push(result.body.opened as string);
    }
    expect(opened).toEqual(["K0001", "K0002", "K0003", "K0004", "K0006", "K0007", "K0008", "K0009", "S001"]);
    // 最後の「締め切って次へ」で S001 も締切になり、次が無いので何も開かない。放映不可は、そのまま
    expect(statuses.S001).toBe("closed");
    expect(statuses.K0005).toBe("not_shown");
    expect(Object.values(statuses).filter((s) => s === "open")).toHaveLength(0);
  });

  it("次が無いときは、締切だけ行い、その旨を伝える", async () => {
    const { repo, statuses } = makeRepo({ statuses: { S001: "open" } });
    const result = await changeVideoStatus(repo, { action: "advance" });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ closed: "S001", opened: null });
    expect(String(result.body.message)).toContain("次の未放映の動画はありません");
    expect(statuses.S001).toBe("closed");
  });

  it("投票中の動画が無いときは、名簿順で最初の未放映の動画を開始する", async () => {
    const { repo, statuses } = makeRepo({ statuses: { K0001: "closed" } });
    expect((await changeVideoStatus(repo, { action: "advance" })).body).toMatchObject({ closed: null, opened: "K0002" });
    expect(statuses.K0002).toBe("open");
  });

  it("開始できる動画が無いときは 409", async () => {
    const all = Object.fromEntries(ROSTER.map(([id]) => [id, "closed" as const]));
    const { repo } = makeRepo({ statuses: all });
    expect((await changeVideoStatus(repo, { action: "advance" })).status).toBe(409);
  });

  it("締切までは成功して、次を開けなかったときは、そのことを伝える(締切は残る)", async () => {
    const { repo, statuses } = makeRepo({ statuses: { K0002: "open" }, forceOutcome: (call) => (call === 2 ? "conflict-open" : undefined) });
    const result = await changeVideoStatus(repo, { action: "advance" });
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ closed: "K0002", opened: null });
    expect(String(result.body.error)).toContain("締切までは済みました");
    expect(statuses.K0002).toBe("closed");
  });

  it("読んだあとに、いまの動画が変わっていたら(stale)、何も開かない", async () => {
    const { repo } = makeRepo({ statuses: { K0002: "open" }, forceOutcome: () => "stale" });
    const result = await changeVideoStatus(repo, { action: "advance" });
    expect(result.status).toBe(409);
    expect(repo.setVideoStatus).toHaveBeenCalledTimes(1);
  });
});

// ---------- 結果発表の段階 ----------
describe("changeRevealStage", () => {
  it.each([0, 1, 2, 3])("段階 %i に変えられる", async (stage) => {
    const { repo, getRevealStage } = makeRepo({ revealStage: 2 });
    const result = await changeRevealStage(repo, { stage });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, revealStage: stage });
    expect(getRevealStage()).toBe(stage);
  });

  it.each([
    ["範囲外(4)", { stage: 4 }],
    ["範囲外(-1)", { stage: -1 }],
    ["小数", { stage: 1.5 }],
    ["文字列", { stage: "1" }],
    ["null", { stage: null }],
    ["段階が無い", {}],
    ["本文が無い", undefined],
    ["配列", [1]],
  ])("不正な段階(%s)は 400 で、発表段階を変えない", async (_label, body) => {
    const { repo, getRevealStage } = makeRepo({ revealStage: 2 });
    expect((await changeRevealStage(repo, body)).status).toBe(400);
    expect(repo.setRevealStage).not.toHaveBeenCalled();
    expect(getRevealStage()).toBe(2);
  });

  it("締切前の動画が残っていても、発表はできる。ただし警告を返す(止めない)", async () => {
    const { repo } = makeRepo({ statuses: { K0001: "closed" } });
    const result = await changeRevealStage(repo, { stage: 3 });
    expect(result.status).toBe(200);
    expect((result.body.warnings as { code: string }[]).map((w) => w.code)).toContain("unfinished-videos");
  });

  it("非表示(0)に戻すときは、警告しない", async () => {
    const { repo } = makeRepo();
    expect((await changeRevealStage(repo, { stage: 0 })).body.warnings).toEqual([]);
  });

  it("DB のエラーは、中身を見せずに 500", async () => {
    const { repo } = makeRepo();
    repo.setRevealStage.mockRejectedValueOnce(new Error("SECRET-DB-DETAIL"));
    quiet();
    const result = await changeRevealStage(repo, { stage: 1 });
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain("SECRET-DB-DETAIL");
  });
});

// ---------- 全データのリセット ----------
describe("resetEverything", () => {
  const seeded = () =>
    makeRepo({
      statuses: { K0001: "closed", K0002: "open", K0003: "not_shown" },
      votes: [vote("K0001", "K0002"), vote("K0003", "K0002")],
      revealStage: 3,
    });

  it("確認の合言葉があれば、投票を全削除し、動画を未放映に戻し、発表段階を 0 にする", async () => {
    const { repo, statuses, getVotes, getRevealStage } = seeded();
    const result = await resetEverything(repo, { confirm: "リセット" });
    expect(result).toEqual({ status: 200, body: { ok: true, deletedVotes: 2 } });
    expect(getVotes()).toEqual([]);
    expect(Object.values(statuses).every((s) => s === "pending")).toBe(true);
    expect(getRevealStage()).toBe(0);
  });

  it.each([
    ["合言葉が無い", {}],
    ["本文が無い", undefined],
    ["空", { confirm: "" }],
    ["英語", { confirm: "reset" }],
    ["違う言葉", { confirm: "リセットする" }],
    ["半角カナ", { confirm: "ﾘｾｯﾄ" }],
    ["真偽値", { confirm: true }],
    ["配列", { confirm: ["リセット"] }],
    ["本文が配列", ["リセット"]],
    ["本文が文字列", "リセット"],
  ])("確認の合言葉が正しくない(%s)と、サーバーが 400 で断り、何も消さない", async (_label, body) => {
    const { repo, getVotes, getRevealStage } = seeded();
    const result = await resetEverything(repo, body);
    expect(result.status).toBe(400);
    expect(String(result.body.error)).toContain("リセット");
    expect(repo.resetAll).not.toHaveBeenCalled();
    expect(getVotes()).toHaveLength(2);
    expect(getRevealStage()).toBe(3);
  });

  it("合言葉の前後の空白は許す", async () => {
    const { repo } = seeded();
    expect((await resetEverything(repo, { confirm: "  リセット " })).status).toBe(200);
  });

  it("途中で失敗したら、中身を見せずに 500。もう一度実行するよう案内する", async () => {
    const { repo } = seeded();
    repo.resetAll.mockRejectedValueOnce(new Error("SECRET-DB-DETAIL"));
    quiet();
    const result = await resetEverything(repo, { confirm: "リセット" });
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain("SECRET-DB-DETAIL");
    expect(String(result.body.error)).toContain("もう一度");
  });

  it("リセットは何度行っても、同じ結果(やり直せる)", async () => {
    const { repo, getVotes } = seeded();
    await resetEverything(repo, { confirm: "リセット" });
    const again = await resetEverything(repo, { confirm: "リセット" });
    expect(again.body).toEqual({ ok: true, deletedVotes: 0 });
    expect(getVotes()).toEqual([]);
  });
});
