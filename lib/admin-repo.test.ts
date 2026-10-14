import { describe, expect, it } from "vitest";
import { createSupabaseAdminRepo } from "./admin-repo";
import type { SeminarVoteClient } from "./supabase";

// Supabase の「問い合わせの書き方」を記録するだけの偽物(本物には接続しない)。
type Call = { table: string; op: string; args: unknown[]; filters: [string, ...unknown[]][] };
type Result = { data?: unknown; error?: { code?: string; message: string } | null };

function fakeClient(provide: (call: Call) => Result) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, op: "", args: [], filters: [] };
      const builder: Record<string, unknown> = {};
      const record = (name: string, store: "op" | "filter") => (...args: unknown[]) => {
        if (store === "op") {
          // 更新・追加・削除のあとの .select() は、「結果の列を指定する」だけなので、操作の種類としては記録しない
          if (!call.op || name !== "select") { call.op = name; call.args = args; }
          if (!calls.includes(call)) calls.push(call);
        } else {
          call.filters.push([name, ...args]);
        }
        return builder;
      };
      for (const op of ["select", "update", "upsert", "delete"]) builder[op] = record(op, "op");
      for (const f of ["eq", "neq", "not", "limit"]) builder[f] = record(f, "filter");
      const settle = () => Promise.resolve({ data: null, error: null, ...provide(call) });
      builder.maybeSingle = () => settle();
      builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => settle().then(resolve, reject);
      return builder;
    },
  } as unknown as SeminarVoteClient;
  return { client, calls };
}

describe("createSupabaseAdminRepo", () => {
  it("動画の一覧:members との結合経路を member_id で指定している(PGRST201 を避ける)", async () => {
    const { client, calls } = fakeClient(() => ({
      data: [{ member_id: "K0002", status: "open", members: { name: "豊臣秀吉", name_en: "Toyotomi Hideyoshi" } }],
    }));
    const rows = await createSupabaseAdminRepo(client).listVideos();
    expect(calls[0].table).toBe("videos");
    expect(String(calls[0].args[0])).toContain("members!member_id(");
    expect(rows).toEqual([{ memberId: "K0002", status: "open", name: "豊臣秀吉", nameEn: "Toyotomi Hideyoshi" }]);
  });

  it("名簿の一覧:id と name だけを読む(トークンは読まない)", async () => {
    const { client, calls } = fakeClient(() => ({ data: [{ id: "K0001", name: "織田信長" }] }));
    expect(await createSupabaseAdminRepo(client).listMembers()).toEqual([{ id: "K0001", name: "織田信長" }]);
    expect(calls[0].args[0]).toBe("id, name");
  });

  it("投票の一覧:点数まで読むが、名前やトークンは読まない", async () => {
    const { client, calls } = fakeClient(() => ({ data: [{ voter_id: "K0001", target_id: "K0002", tech: 3, impact: 4 }] }));
    expect(await createSupabaseAdminRepo(client).listVotes()).toEqual([{ voterId: "K0001", targetId: "K0002", tech: 3, impact: 4 }]);
    expect(calls[0].args[0]).toBe("voter_id, target_id, tech, impact");
  });

  it("発表段階:app_state の id=1 を読む。行が無ければ 0", async () => {
    const found = fakeClient(() => ({ data: { reveal_stage: 2 } }));
    expect(await createSupabaseAdminRepo(found.client).getRevealStage()).toBe(2);
    expect(found.calls[0].filters).toContainEqual(["eq", "id", 1]);
    const missing = fakeClient(() => ({ data: null }));
    expect(await createSupabaseAdminRepo(missing.client).getRevealStage()).toBe(0);
  });

  describe("setVideoStatus(読んだときの状態のときだけ変える)", () => {
    it("変えられたら ok。動画のIDと、変更前の状態の両方で絞り込む", async () => {
      const { client, calls } = fakeClient(() => ({ data: [{ member_id: "K0002" }] }));
      expect(await createSupabaseAdminRepo(client).setVideoStatus("K0002", "pending", "open")).toBe("ok");
      expect(calls[0].op).toBe("update");
      expect(calls[0].args[0]).toEqual({ status: "open" });
      expect(calls[0].filters).toContainEqual(["eq", "member_id", "K0002"]);
      expect(calls[0].filters).toContainEqual(["eq", "status", "pending"]);
    });

    it("1行も変わらなければ(あとから状態が変わっていた)stale", async () => {
      const { client } = fakeClient(() => ({ data: [] }));
      expect(await createSupabaseAdminRepo(client).setVideoStatus("K0002", "pending", "open")).toBe("stale");
    });

    it("DB の制約(open は 1 本だけ。エラー 23505)は conflict-open", async () => {
      const { client } = fakeClient(() => ({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } }));
      expect(await createSupabaseAdminRepo(client).setVideoStatus("K0002", "pending", "open")).toBe("conflict-open");
    });

    it("そのほかの DB エラーは、例外にする(呼び出し側が 500 に変える)", async () => {
      const { client } = fakeClient(() => ({ data: null, error: { code: "XX000", message: "boom" } }));
      await expect(createSupabaseAdminRepo(client).setVideoStatus("K0002", "pending", "open")).rejects.toThrow(/XX000/);
    });
  });

  it("発表段階の変更:app_state の id=1 に書く", async () => {
    const { client, calls } = fakeClient(() => ({ data: null }));
    await createSupabaseAdminRepo(client).setRevealStage(2);
    expect(calls[0]).toMatchObject({ table: "app_state", op: "upsert" });
    expect(calls[0].args[0]).toEqual({ id: 1, reveal_stage: 2 });
  });

  describe("resetAll(全データのリセット)", () => {
    const provide = (call: Call): Result =>
      call.table === "votes" ? { data: [{ voter_id: "K0001" }, { voter_id: "K0003" }] } : { data: [] };

    it("順序:発表段階を 0 → 動画を pending → 投票を削除。削除した投票の件数を返す", async () => {
      const { client, calls } = fakeClient(provide);
      const result = await createSupabaseAdminRepo(client).resetAll();
      expect(calls.map((c) => `${c.table}:${c.op}`)).toEqual(["app_state:upsert", "videos:update", "votes:delete"]);
      expect(calls[0].args[0]).toEqual({ id: 1, reveal_stage: 0 });
      expect(calls[1].args[0]).toEqual({ status: "pending" });
      expect(result).toEqual({ deletedVotes: 2 });
    });

    it("更新・削除には、必ず条件(WHERE)がつく(条件なしの全件操作にならない)", async () => {
      const { client, calls } = fakeClient(provide);
      await createSupabaseAdminRepo(client).resetAll();
      expect(calls[1].filters.length).toBeGreaterThan(0);
      expect(calls[2].filters.length).toBeGreaterThan(0);
    });

    it("途中で失敗したら、そこで止まる(あとの操作に進まない)。例外にする", async () => {
      const first = fakeClient((call) => (call.table === "app_state" ? { error: { code: "XX", message: "boom" } } : { data: [] }));
      await expect(createSupabaseAdminRepo(first.client).resetAll()).rejects.toThrow();
      expect(first.calls.map((c) => c.table)).toEqual(["app_state"]);

      const second = fakeClient((call) => (call.table === "videos" ? { error: { code: "XX", message: "boom" } } : { data: [] }));
      await expect(createSupabaseAdminRepo(second.client).resetAll()).rejects.toThrow();
      expect(second.calls.map((c) => c.table)).toEqual(["app_state", "videos"]); // 投票は、まだ消していない
    });
  });
});
