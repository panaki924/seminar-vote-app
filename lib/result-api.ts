// 結果 API の「判断」。DB には直接触れず、窓口(ResultRepo)だけを通す。
// 【大事】発表段階(reveal_stage)で、まだ見せてはいけない順位は、画面で隠すのではなく、
// ここで、返事に「そもそも含めない」。全順位の一覧は、この関数の外に出さない。
import { computeRanking, filterByRevealStage } from "./ranking";
import { REVEAL_STAGE_LABELS } from "./admin-rules";
import type { AdminRepo } from "./admin-service";

export type ResultRepo = Pick<AdminRepo, "listVideos" | "listVotes" | "getRevealStage">;

export type ResultEntry = { name: string; nameEn: string; techAvg: number; impactAvg: number; total: number };
export type ResultPlace = { rank: number; entries: ResultEntry[] }; // entries が空なら「該当者なし」
export type ResultBody = { ok: true; stage: 0 | 1 | 2 | 3; label: string; places: ResultPlace[] };
export type ResultFailure = { ok: false; error: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function getResult(repo: ResultRepo): Promise<{ status: number; body: ResultBody | ResultFailure }> {
  try {
    const [videos, votes, rawStage] = await Promise.all([repo.listVideos(), repo.listVotes(), repo.getRevealStage()]);
    const stage = (rawStage === 1 || rawStage === 2 || rawStage === 3 ? rawStage : 0) as 0 | 1 | 2 | 3;
    if (stage === 0) {
      // 非表示のときは、順位の計算もしない(何も返さない)
      return { status: 200, body: { ok: true, stage, label: REVEAL_STAGE_LABELS[0], places: [] } };
    }
    const names = new Map(videos.map((v) => [v.memberId, v]));
    const ranking = computeRanking(
      videos.map((v) => ({ memberId: v.memberId, status: v.status })),
      votes,
    );
    // 発表済みの順位だけを取り出す。それ以外(まだ見せない順位)は、ここで捨てる
    const places: ResultPlace[] = filterByRevealStage(ranking, stage).map((place) => ({
      rank: place.rank,
      entries: place.entries.map((e) => ({
        name: names.get(e.memberId)?.name ?? "",
        nameEn: names.get(e.memberId)?.nameEn ?? "",
        techAvg: round2(e.techAvg),
        impactAvg: round2(e.impactAvg),
        total: round2(e.total),
      })),
    }));
    return { status: 200, body: { ok: true, stage, label: REVEAL_STAGE_LABELS[stage], places } };
  } catch (error) {
    console.error("[api/result] 失敗:", error instanceof Error ? error.message : "unknown");
    return { status: 500, body: { ok: false, error: "サーバーでエラーが起きました。少し待ってから、もう一度お試しください。" } };
  }
}
