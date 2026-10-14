// AdminRepo の本物の実装(Supabase の seminar_vote スキーマに読み書きする)。サーバー専用。
// ・名簿は id と name だけ読む(トークンは読まない)。
// ・更新・削除には、必ず条件(WHERE)をつける。
import type { VideoStatus } from "./ranking";
import type { AdminMemberRow, AdminRepo, AdminVideoRow, AdminVoteRow, SetStatusOutcome } from "./admin-service";
import { getSupabase, type SeminarVoteClient } from "./supabase";

const fail = (what: string, error: { code?: string; message: string }) =>
  new Error(`${what}: ${error.code ?? ""} ${error.message}`);

export function createSupabaseAdminRepo(client: SeminarVoteClient = getSupabase()): AdminRepo {
  return {
    async listVideos(): Promise<AdminVideoRow[]> {
      const { data, error } = await client
        // members!member_id … 「member_id の列でつながる members」と経路を指定する(PGRST201 を避ける)
        .from("videos")
        .select("member_id, status, members!member_id(name, name_en)");
      if (error) throw fail("videos 取得", error);
      return (data ?? []).map((row: { member_id: string; status: VideoStatus; members: unknown }) => {
        const m = (Array.isArray(row.members) ? row.members[0] : row.members) as
          | { name: string; name_en: string }
          | null
          | undefined;
        return { memberId: row.member_id, status: row.status, name: m?.name ?? "", nameEn: m?.name_en ?? "" };
      });
    },

    async listMembers(): Promise<AdminMemberRow[]> {
      const { data, error } = await client.from("members").select("id, name"); // token の列は読まない
      if (error) throw fail("members 取得", error);
      return (data ?? []).map((m: { id: string; name: string }) => ({ id: m.id, name: m.name }));
    },

    async listVotes(): Promise<AdminVoteRow[]> {
      const { data, error } = await client.from("votes").select("voter_id, target_id, tech, impact");
      if (error) throw fail("votes 取得", error);
      return (data ?? []).map((v: { voter_id: string; target_id: string; tech: number; impact: number }) => ({
        voterId: v.voter_id,
        targetId: v.target_id,
        tech: v.tech,
        impact: v.impact,
      }));
    },

    async getRevealStage(): Promise<number> {
      const { data, error } = await client.from("app_state").select("reveal_stage").eq("id", 1).maybeSingle();
      if (error) throw fail("app_state 取得", error);
      return data ? (data.reveal_stage as number) : 0;
    },

    async setVideoStatus(memberId, from, to): Promise<SetStatusOutcome> {
      const { data, error } = await client
        .from("videos")
        .update({ status: to })
        .eq("member_id", memberId)
        .eq("status", from) // 読んだときの状態のままのときだけ変える(あとから変わっていたら、何もしない)
        .select("member_id");
      if (error) {
        if (error.code === "23505") return "conflict-open"; // 部分ユニークインデックス:open は 1 本だけ
        throw fail("videos 更新", error);
      }
      return data && data.length > 0 ? "ok" : "stale";
    },

    async setRevealStage(stage): Promise<void> {
      const { error } = await client.from("app_state").upsert({ id: 1, reveal_stage: stage }, { onConflict: "id" });
      if (error) throw fail("app_state 更新", error);
    },

    async resetAll(): Promise<{ deletedVotes: number }> {
      // 順序:結果の公開を止める → 動画を未放映に戻す → 投票を削除(途中で失敗しても、もう一度実行できる)
      const stage = await client.from("app_state").upsert({ id: 1, reveal_stage: 0 }, { onConflict: "id" });
      if (stage.error) throw fail("リセット(発表段階)", stage.error);

      const videos = await client.from("videos").update({ status: "pending" }).neq("member_id", "").select("member_id");
      if (videos.error) throw fail("リセット(動画の状態)", videos.error);

      const votes = await client.from("votes").delete().neq("voter_id", "").select("voter_id");
      if (votes.error) throw fail("リセット(投票の削除)", votes.error);
      return { deletedVotes: votes.data ? votes.data.length : 0 };
    },
  };
}
