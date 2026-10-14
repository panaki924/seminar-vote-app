// VoteRepo の本物の実装(Supabase の seminar_vote スキーマに読み書きする)。
// サーバー専用。ここで読む列は、必要なものだけに絞る(トークンは「一致する人を探す」ときの条件にだけ使い、返さない)。
import type { OpenVideoRow, VoteRepo, VoteRow, VoterRow } from "./vote-api";
import { getSupabase, type SeminarVoteClient } from "./supabase";

type VoteDbRow = { tech: number; impact: number; updated_at: string };

const toVoteRow = (row: VoteDbRow): VoteRow => ({
  tech: row.tech,
  impact: row.impact,
  updatedAt: row.updated_at,
});

export function createSupabaseVoteRepo(client: SeminarVoteClient = getSupabase()): VoteRepo {
  return {
    async findMemberByToken(token): Promise<VoterRow | null> {
      const { data, error } = await client
        .from("members")
        .select("id, name") // token の列は返さない
        .eq("token", token)
        .maybeSingle();
      if (error) throw new Error(`members 取得: ${error.code ?? ""} ${error.message}`);
      return data ? { id: data.id, name: data.name } : null;
    },

    async findOpenVideos(): Promise<OpenVideoRow[]> {
      const { data, error } = await client
        .from("videos")
        // members!member_id … 「member_id の列でつながる members」と経路を指定する。
        // 指定しないと、votes を経由する遠回りの経路もあるため、PostgREST が選べずに失敗する(PGRST201)。
        .select("member_id, members!member_id(name, name_en)")
        .eq("status", "open")
        .limit(2);
      if (error) throw new Error(`videos 取得: ${error.code ?? ""} ${error.message}`);
      return (data ?? []).map((row: { member_id: string; members: unknown }) => {
        // 参照先(members)は1件のオブジェクトで返る。念のため配列で返ってきても先頭を使う
        const m = (Array.isArray(row.members) ? row.members[0] : row.members) as
          | { name: string; name_en: string }
          | null
          | undefined;
        return { memberId: row.member_id, name: m?.name ?? "", nameEn: m?.name_en ?? "" };
      });
    },

    async findVote(voterId, targetId): Promise<VoteRow | null> {
      const { data, error } = await client
        .from("votes")
        .select("tech, impact, updated_at")
        .eq("voter_id", voterId)
        .eq("target_id", targetId)
        .maybeSingle();
      if (error) throw new Error(`votes 取得: ${error.code ?? ""} ${error.message}`);
      return data ? toVoteRow(data as VoteDbRow) : null;
    },

    async upsertVote({ voterId, targetId, tech, impact, updatedAt }): Promise<VoteRow> {
      const { data, error } = await client
        .from("votes")
        .upsert(
          { voter_id: voterId, target_id: targetId, tech, impact, updated_at: updatedAt },
          { onConflict: "voter_id,target_id" }, // 主キー。同じ組み合わせなら上書きする
        )
        .select("tech, impact, updated_at")
        .single();
      if (error) throw new Error(`votes 保存: ${error.code ?? ""} ${error.message}`);
      return toVoteRow(data as VoteDbRow);
    },
  };
}
