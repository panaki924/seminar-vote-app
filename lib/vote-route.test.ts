import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VoteRepo } from "./vote-api";

// Route Handler(app/api/vote/route.ts)の「HTTP としての見た目」だけを確かめる。
// DB の窓口は偽物に差し替える(本物の Supabase には接続しない)。
const TOKEN = "t".repeat(64);

const repo: VoteRepo = {
  findMemberByToken: vi.fn(async (token: string) => (token === TOKEN ? { id: "K0001", name: "織田信長" } : null)),
  findOpenVideos: vi.fn(async () => [{ memberId: "K0002", name: "豊臣秀吉", nameEn: "Toyotomi Hideyoshi" }]),
  findVote: vi.fn(async () => null),
  upsertVote: vi.fn(async (v) => ({ tech: v.tech, impact: v.impact, updatedAt: v.updatedAt })),
};

vi.mock("./vote-repo", () => ({ createSupabaseVoteRepo: () => repo }));

const { GET, POST } = await import("../app/api/vote/route");

const url = "http://localhost/api/vote";
const post = (payload: BodyInit | null, token: string | null = TOKEN) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { "x-vote-token": token } : {}) },
    body: payload,
  });

describe("GET /api/vote", () => {
  beforeEach(() => vi.clearAllMocks());

  it("トークンがあれば 200 で状態を返し、キャッシュさせない", async () => {
    const res = await GET(new Request(url, { headers: { "x-vote-token": TOKEN } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, voter: { id: "K0001" }, current: { videoId: "K0002", isOwn: false } });
  });

  it("トークンが無ければ 401。エラーの返事もキャッシュさせない", async () => {
    const res = await GET(new Request(url));
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("URL のクエリにトークンを付けても、本人確認には使われない(ヘッダーだけ)", async () => {
    const res = await GET(new Request(`${url}?token=${TOKEN}`));
    expect(res.status).toBe(401);
  });

  it("返事に SUPABASE_SECRET_KEY の値は含まれない", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_dummy_route_test_value");
    try {
      const res = await GET(new Request(url, { headers: { "x-vote-token": TOKEN } }));
      expect(await res.text()).not.toContain("sb_secret_dummy_route_test_value");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("POST /api/vote", () => {
  beforeEach(() => vi.clearAllMocks());

  it("正しい投票は 200 で保存され、キャッシュさせない", async () => {
    const res = await POST(post(JSON.stringify({ targetId: "K0002", tech: 4, impact: 5 })));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(repo.upsertVote).toHaveBeenCalledWith(
      expect.objectContaining({ voterId: "K0001", targetId: "K0002", tech: 4, impact: 5 }),
    );
  });

  it("JSON として読めない本文は 400 で、保存しない", async () => {
    const res = await POST(post("{ not json"));
    expect(res.status).toBe(400);
    expect(repo.upsertVote).not.toHaveBeenCalled();
  });

  it("本文が空でも 400 で、保存しない", async () => {
    const res = await POST(post(null));
    expect(res.status).toBe(400);
    expect(repo.upsertVote).not.toHaveBeenCalled();
  });

  it("範囲外の点数は 400", async () => {
    const res = await POST(post(JSON.stringify({ targetId: "K0002", tech: 6, impact: 3 })));
    expect(res.status).toBe(400);
    expect(repo.upsertVote).not.toHaveBeenCalled();
  });

  it("トークンが無ければ 401", async () => {
    const res = await POST(post(JSON.stringify({ targetId: "K0002", tech: 3, impact: 3 }), null));
    expect(res.status).toBe(401);
    expect(repo.upsertVote).not.toHaveBeenCalled();
  });
});
