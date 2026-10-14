import { describe, expect, it, vi } from "vitest";
import { createSupabaseVoteRepo } from "./vote-repo";
import type { SeminarVoteClient } from "./supabase";

// Supabase の「問い合わせの書き方」を記録するだけの偽物(本物には接続しない)。
// 本物の DB で起きた失敗(PGRST201:結合の経路が複数あって選べない)を二度と入れないための見張り役。
function fakeClient(result: { data: unknown; error: null | { code: string; message: string } }) {
  const calls: { table: string; select?: string; filters: Record<string, unknown>[] } = {
    table: "",
    filters: [],
  };
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  Object.assign(builder, {
    select: vi.fn((columns: string) => {
      calls.select = columns;
      return builder;
    }),
    eq: vi.fn((column: string, value: unknown) => {
      calls.filters.push({ [column]: value });
      return builder;
    }),
    limit: vi.fn(chain),
    upsert: vi.fn(chain),
    maybeSingle: vi.fn(async () => result),
    single: vi.fn(async () => result),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  });
  const client = {
    from: vi.fn((table: string) => {
      calls.table = table;
      return builder;
    }),
  } as unknown as SeminarVoteClient;
  return { client, calls };
}

describe("createSupabaseVoteRepo", () => {
  it("投票中の動画の取得では、members との結合経路を member_id で指定している", async () => {
    const { client, calls } = fakeClient({
      data: [{ member_id: "K0002", members: { name: "豊臣秀吉", name_en: "Toyotomi Hideyoshi" } }],
      error: null,
    });
    const rows = await createSupabaseVoteRepo(client).findOpenVideos();
    expect(calls.table).toBe("videos");
    expect(calls.select).toContain("members!member_id(");
    expect(calls.filters).toContainEqual({ status: "open" });
    expect(rows).toEqual([{ memberId: "K0002", name: "豊臣秀吉", nameEn: "Toyotomi Hideyoshi" }]);
  });

  it("members が配列で返ってきても、先頭を使う", async () => {
    const { client } = fakeClient({
      data: [{ member_id: "K0002", members: [{ name: "豊臣秀吉", name_en: "Toyotomi Hideyoshi" }] }],
      error: null,
    });
    const rows = await createSupabaseVoteRepo(client).findOpenVideos();
    expect(rows[0]).toMatchObject({ memberId: "K0002", name: "豊臣秀吉" });
  });

  it("open の動画が無ければ空の配列を返す", async () => {
    const { client } = fakeClient({ data: [], error: null });
    expect(await createSupabaseVoteRepo(client).findOpenVideos()).toEqual([]);
  });

  it("DB がエラーを返したら例外にする(呼び出し側が 500 に変える)", async () => {
    const { client } = fakeClient({ data: null, error: { code: "PGRST201", message: "ambiguous" } });
    await expect(createSupabaseVoteRepo(client).findOpenVideos()).rejects.toThrow(/PGRST201/);
  });

  it("参加者の検索では token の列を取得しない(条件にだけ使う)", async () => {
    const { client, calls } = fakeClient({ data: { id: "K0001", name: "織田信長" }, error: null });
    const member = await createSupabaseVoteRepo(client).findMemberByToken("x".repeat(64));
    expect(calls.table).toBe("members");
    expect(calls.select).toBe("id, name");
    expect(member).toEqual({ id: "K0001", name: "織田信長" });
  });

  it("どの問い合わせも、他のテーブルを結合する書き方は動画の取得だけ", async () => {
    const queries: string[] = [];
    for (const run of [
      (r: ReturnType<typeof createSupabaseVoteRepo>) => r.findMemberByToken("x".repeat(64)),
      (r: ReturnType<typeof createSupabaseVoteRepo>) => r.findVote("K0001", "K0002"),
      (r: ReturnType<typeof createSupabaseVoteRepo>) =>
        r.upsertVote({ voterId: "K0001", targetId: "K0002", tech: 3, impact: 3, updatedAt: "2026-10-22T00:00:00Z" }),
    ]) {
      const { client, calls } = fakeClient({ data: { id: "a", name: "b", tech: 3, impact: 3, updated_at: "t" }, error: null });
      await run(createSupabaseVoteRepo(client));
      queries.push(calls.select ?? "");
    }
    for (const q of queries) expect(q).not.toContain("(");
  });
});
