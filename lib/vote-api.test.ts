import { describe, expect, it, vi } from "vitest";
import {
  getVoteState,
  normalizeToken,
  parseScore,
  submitVote,
  type OpenVideoRow,
  type VoteRepo,
  type VoteRow,
} from "./vote-api";

// ---------- テスト用の偽物の DB(本物の Supabase には接続しない) ----------
// ダミーのトークン(本物ではない)。形式は本物と同じ英数字64文字
const TOKEN_A = "a".repeat(64); // K0001
const TOKEN_B = "b".repeat(64); // K0002
const TOKEN_C = "c".repeat(64); // K0003
const UNKNOWN_TOKEN = "z".repeat(64); // どの参加者にも対応しない

type Status = "pending" | "open" | "closed" | "not_shown";

function makeRepo(statuses: Record<string, Status>) {
  const members = [
    { id: "K0001", name: "織田信長", nameEn: "Oda Nobunaga", token: TOKEN_A },
    { id: "K0002", name: "豊臣秀吉", nameEn: "Toyotomi Hideyoshi", token: TOKEN_B },
    { id: "K0003", name: "徳川家康", nameEn: "Tokugawa Ieyasu", token: TOKEN_C },
  ];
  const votes = new Map<string, VoteRow & { voterId: string; targetId: string }>();
  const keyOf = (voter: string, target: string) => `${voter}>${target}`;

  const repo = {
    findMemberByToken: vi.fn(async (token: string) => {
      const m = members.find((x) => x.token === token);
      return m ? { id: m.id, name: m.name } : null;
    }),
    findOpenVideos: vi.fn(async (): Promise<OpenVideoRow[]> =>
      members
        .filter((m) => statuses[m.id] === "open")
        .map((m) => ({ memberId: m.id, name: m.name, nameEn: m.nameEn })),
    ),
    findVote: vi.fn(async (voterId: string, targetId: string) => {
      const v = votes.get(keyOf(voterId, targetId));
      return v ? { tech: v.tech, impact: v.impact, updatedAt: v.updatedAt } : null;
    }),
    upsertVote: vi.fn(async (vote: { voterId: string; targetId: string; tech: number; impact: number; updatedAt: string }) => {
      votes.set(keyOf(vote.voterId, vote.targetId), vote); // 同じキーなら上書き(本物の DB の主キーと同じ動き)
      return { tech: vote.tech, impact: vote.impact, updatedAt: vote.updatedAt };
    }),
  } satisfies VoteRepo;

  return { repo, votes };
}

const body = (tech: unknown, impact: unknown, targetId: unknown = "K0002") => ({
  targetId,
  tech,
  impact,
});

// ---------- 入力チェック ----------
describe("normalizeToken", () => {
  it("英数字・ハイフン・アンダースコアの16〜128文字だけ通す", () => {
    expect(normalizeToken(TOKEN_A)).toBe(TOKEN_A);
    expect(normalizeToken(`  ${TOKEN_A}  `)).toBe(TOKEN_A); // 前後の空白は無視
  });
  it.each([null, undefined, "", "short", "a".repeat(129), `${"a".repeat(20)} ${"b".repeat(20)}`, "あ".repeat(20), `${"a".repeat(20)}'; drop`])(
    "形式が違うものは null にする: %s",
    (value) => {
      expect(normalizeToken(value as string | null | undefined)).toBeNull();
    },
  );
});

describe("parseScore", () => {
  it.each([1, 2, 3, 4, 5])("%i は通す", (n) => expect(parseScore(n)).toBe(n));
  it.each([0, 6, -1, 3.5, 4.0000001, NaN, Infinity, "3", "", null, undefined, true, [], {}])(
    "%j は拒否する",
    (value) => expect(parseScore(value)).toBeNull(),
  );
});

// ---------- 1. 本人確認 + 状態の取得 ----------
describe("getVoteState", () => {
  it("他人の動画が投票中で、未送信なら current と myVote=null を返す", async () => {
    const { repo } = makeRepo({ K0001: "pending", K0002: "open", K0003: "pending" });
    const result = await getVoteState(repo, TOKEN_A);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      voter: { id: "K0001", name: "織田信長" },
      current: { videoId: "K0002", name: "豊臣秀吉", nameEn: "Toyotomi Hideyoshi", isOwn: false },
      myVote: null,
    });
  });

  it("送信済みなら、その内容(自分の投票だけ)を返す", async () => {
    const { repo } = makeRepo({ K0002: "open" });
    await submitVote(repo, TOKEN_A, body(4, 5), new Date("2026-10-22T10:00:00Z"));
    const result = await getVoteState(repo, TOKEN_A);
    expect(result.body.myVote).toEqual({ tech: 4, impact: 5, updatedAt: "2026-10-22T10:00:00.000Z" });
  });

  it("自分の動画が投票中なら isOwn=true で、myVote は null。投票の検索もしない", async () => {
    const { repo } = makeRepo({ K0001: "open" });
    const result = await getVoteState(repo, TOKEN_A);
    expect(result.body.current).toMatchObject({ videoId: "K0001", isOwn: true });
    expect(result.body.myVote).toBeNull();
    expect(repo.findVote).not.toHaveBeenCalled();
  });

  it("投票中の動画が無ければ current=null", async () => {
    const { repo } = makeRepo({ K0001: "pending", K0002: "closed", K0003: "not_shown" });
    const result = await getVoteState(repo, TOKEN_A);
    expect(result.status).toBe(200);
    expect(result.body.current).toBeNull();
    expect(result.body.myVote).toBeNull();
  });

  it("形式が違うトークンと、存在しないトークンは、まったく同じエラーになる", async () => {
    const { repo } = makeRepo({ K0002: "open" });
    const malformed = await getVoteState(repo, "short");
    const missing = await getVoteState(repo, null);
    const unknown = await getVoteState(repo, UNKNOWN_TOKEN);
    expect(malformed.status).toBe(401);
    expect(malformed).toEqual(unknown);
    expect(missing).toEqual(unknown);
    // 形式違いのときは、DB への問い合わせもしない
    expect(repo.findMemberByToken).toHaveBeenCalledTimes(1);
  });

  it("返す内容に、トークンや他人の投票・他人の情報は含まれない", async () => {
    const { repo } = makeRepo({ K0002: "open" });
    await submitVote(repo, TOKEN_B, body(5, 5, "K0003")); // 投票中ではないので拒否される(保存されない)
    await submitVote(repo, TOKEN_C, body(1, 1)); // 他人(K0003)の投票
    const result = await getVoteState(repo, TOKEN_A);
    const text = JSON.stringify(result.body);
    for (const token of [TOKEN_A, TOKEN_B, TOKEN_C]) expect(text).not.toContain(token);
    expect(text).not.toContain("K0003"); // 他の参加者の情報は出ない
    expect(result.body.myVote).toBeNull(); // 他人の投票は返さない
  });

  it("open の動画が2本あるという異常な状態では、投票させず 500 にする", async () => {
    const { repo } = makeRepo({ K0001: "open", K0002: "open" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await getVoteState(repo, TOKEN_C);
    expect(result.status).toBe(500);
  });

  it("DB のエラーは、中身を見せずに 500 の日本語メッセージにする", async () => {
    const { repo } = makeRepo({ K0002: "open" });
    repo.findOpenVideos.mockRejectedValueOnce(new Error("SECRET-DB-DETAIL relation xyz"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await getVoteState(repo, TOKEN_A);
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain("SECRET-DB-DETAIL");
    expect(String(result.body.error)).toContain("もう一度");
  });
});

// ---------- 2. 投票の送信 ----------
describe("submitVote", () => {
  it("投票中の動画に、正しい点数で投票できる(投票者はトークン、投票先は open の動画)", async () => {
    const { repo, votes } = makeRepo({ K0002: "open" });
    const result = await submitVote(repo, TOKEN_A, body(3, 4), new Date("2026-10-22T10:00:00Z"));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      myVote: { tech: 3, impact: 4, updatedAt: "2026-10-22T10:00:00.000Z" },
    });
    expect(repo.upsertVote).toHaveBeenCalledWith({
      voterId: "K0001",
      targetId: "K0002",
      tech: 3,
      impact: 4,
      updatedAt: "2026-10-22T10:00:00.000Z",
    });
    expect(votes.size).toBe(1);
  });

  it("再投票は上書きされ、行は1つのまま(最後に送った内容が残る)", async () => {
    const { repo, votes } = makeRepo({ K0002: "open" });
    await submitVote(repo, TOKEN_A, body(3, 4), new Date("2026-10-22T10:00:00Z"));
    await submitVote(repo, TOKEN_A, body(5, 2), new Date("2026-10-22T10:01:00Z"));
    expect(votes.size).toBe(1);
    expect([...votes.values()][0]).toMatchObject({ tech: 5, impact: 2, updatedAt: "2026-10-22T10:01:00.000Z" });
    const state = await getVoteState(repo, TOKEN_A);
    expect(state.body.myVote).toEqual({ tech: 5, impact: 2, updatedAt: "2026-10-22T10:01:00.000Z" });
  });

  it("自分の動画への投票は拒否する(403)。保存もしない", async () => {
    const { repo } = makeRepo({ K0001: "open" });
    const result = await submitVote(repo, TOKEN_A, body(5, 5, "K0001"));
    expect(result.status).toBe(403);
    expect(String(result.body.error)).toContain("あなたの動画");
    expect(repo.upsertVote).not.toHaveBeenCalled();
  });

  it("自分の動画が投票中でなくても、自分あての投票は拒否する", async () => {
    const { repo } = makeRepo({ K0002: "open" });
    const result = await submitVote(repo, TOKEN_A, body(5, 5, "K0001"));
    expect(result.status).toBe(403);
    expect(repo.upsertVote).not.toHaveBeenCalled();
  });

  it.each([
    ["0 点", 0],
    ["6 点", 6],
    ["負の数", -1],
    ["小数", 3.5],
    ["文字列の数字", "3"],
    ["null", null],
    ["真偽値", true],
    ["配列", [3]],
  ])("技術点が不正(%s)なら 400 で拒否する", async (_label, bad) => {
    const { repo } = makeRepo({ K0002: "open" });
    const result = await submitVote(repo, TOKEN_A, body(bad, 3));
    expect(result.status).toBe(400);
    expect(String(result.body.error)).toContain("1〜5");
    expect(repo.upsertVote).not.toHaveBeenCalled();
  });

  it("インパクト点が不正でも 400 で拒否する", async () => {
    const { repo } = makeRepo({ K0002: "open" });
    expect((await submitVote(repo, TOKEN_A, body(3, 6))).status).toBe(400);
    expect((await submitVote(repo, TOKEN_A, body(3, 2.5))).status).toBe(400);
    expect((await submitVote(repo, TOKEN_A, { targetId: "K0002", tech: 3 })).status).toBe(400); // impact なし
    expect(repo.upsertVote).not.toHaveBeenCalled();
  });

  it.each<[string, Status]>([
    ["未放映(pending)", "pending"],
    ["締切後(closed)", "closed"],
    ["放映不可(not_shown)", "not_shown"],
  ])("%s の動画には投票できない(409)", async (_label, status) => {
    // K0002 が上の状態で、投票中の動画は無い
    const { repo } = makeRepo({ K0002: status });
    const result = await submitVote(repo, TOKEN_A, body(3, 3, "K0002"));
    expect(result.status).toBe(409);
    expect(String(result.body.error)).toContain("投票中の動画はありません");
    expect(repo.upsertVote).not.toHaveBeenCalled();
  });

  it("締切(closed)に切り替わった後の再送信は、拒否されて元の投票が残る", async () => {
    const statuses: Record<string, Status> = { K0002: "open" };
    const { repo, votes } = makeRepo(statuses);
    await submitVote(repo, TOKEN_A, body(3, 4));
    statuses.K0002 = "closed"; // 管理者が締切にした
    const result = await submitVote(repo, TOKEN_A, body(5, 5));
    expect(result.status).toBe(409);
    expect([...votes.values()][0]).toMatchObject({ tech: 3, impact: 4 });
  });

  it("送られた投票先が、いま open の動画と違えば拒否する(別の動画に勝手に入れない)", async () => {
    const { repo } = makeRepo({ K0002: "open", K0003: "pending" });
    const result = await submitVote(repo, TOKEN_A, body(3, 3, "K0003"));
    expect(result.status).toBe(409);
    expect(String(result.body.error)).toContain("切り替わりました");
    expect(repo.upsertVote).not.toHaveBeenCalled();
  });

  it("投票先が送られていない/文字列でないときは 400", async () => {
    const { repo } = makeRepo({ K0002: "open" });
    expect((await submitVote(repo, TOKEN_A, { tech: 3, impact: 3 })).status).toBe(400);
    expect((await submitVote(repo, TOKEN_A, body(3, 3, 2))).status).toBe(400);
    expect((await submitVote(repo, TOKEN_A, body(3, 3, ""))).status).toBe(400);
    expect(repo.upsertVote).not.toHaveBeenCalled();
  });

  it("本文が JSON のオブジェクトでなければ 400", async () => {
    const { repo } = makeRepo({ K0002: "open" });
    for (const bad of [undefined, null, "text", 42, [1, 2]]) {
      expect((await submitVote(repo, TOKEN_A, bad)).status).toBe(400);
    }
    expect(repo.upsertVote).not.toHaveBeenCalled();
  });

  it("不正なトークンは、形式違いも存在しないものも同じ 401 になり、何も保存されない", async () => {
    const { repo } = makeRepo({ K0002: "open" });
    const malformed = await submitVote(repo, "short", body(3, 3));
    const unknown = await submitVote(repo, UNKNOWN_TOKEN, body(3, 3));
    const missing = await submitVote(repo, null, body(3, 3));
    expect(malformed.status).toBe(401);
    expect(unknown).toEqual(malformed);
    expect(missing).toEqual(malformed);
    expect(repo.upsertVote).not.toHaveBeenCalled();
  });

  it("本文に voterId などを混ぜても無視し、投票者はトークンから決める", async () => {
    const { repo, votes } = makeRepo({ K0002: "open" });
    await submitVote(repo, TOKEN_A, { ...body(3, 3), voterId: "K0003", voter_id: "K0003", isOwn: false });
    expect([...votes.values()].map((v) => v.voterId)).toEqual(["K0001"]);
  });

  it("DB の保存に失敗したら、中身を見せずに 500 にする", async () => {
    const { repo } = makeRepo({ K0002: "open" });
    repo.upsertVote.mockRejectedValueOnce(new Error("SECRET-DB-DETAIL"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await submitVote(repo, TOKEN_A, body(3, 3));
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain("SECRET-DB-DETAIL");
  });

  it("open の動画が2本あるという異常な状態では、保存しない", async () => {
    const { repo } = makeRepo({ K0001: "open", K0002: "open" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await submitVote(repo, TOKEN_C, body(3, 3));
    expect(result.status).toBe(500);
    expect(repo.upsertVote).not.toHaveBeenCalled();
  });
});
