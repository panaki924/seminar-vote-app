// 管理 API の「判断」。DB には直接触れず、AdminRepo という窓口だけを通す。
// → テストでは AdminRepo を偽物に差し替えて、本物の DB なしで動きを確かめられる。
// 認証(ログイン済みか)は、ここではなく、lib/admin-handlers.ts の入口で、1本ごとに毎回確かめる。
import {
  allowedActions,
  isResetConfirmed,
  isValidRevealStage,
  isVideoAction,
  pickNextVideo,
  RESET_CONFIRM_PHRASE,
  REVEAL_STAGE_LABELS,
  revealWarnings,
  sortByRoster,
  STATUS_LABELS,
  compareRosterOrder,
  applyVideoAction,
  type RevealWarning,
  type VideoAction,
} from "./admin-rules";
import { computeRanking, type VideoStatus } from "./ranking";

// ---------- DB への窓口(本物は lib/admin-repo.ts、テストでは偽物) ----------
export type AdminVideoRow = { memberId: string; name: string; nameEn: string; status: VideoStatus };
export type AdminMemberRow = { id: string; name: string };
export type AdminVoteRow = { voterId: string; targetId: string; tech: number; impact: number };
/** ok=変更できた / stale=読んだ後に状態が変わっていた / conflict-open=ほかの動画が投票中で、open にできない */
export type SetStatusOutcome = "ok" | "stale" | "conflict-open";

export interface AdminRepo {
  listVideos(): Promise<AdminVideoRow[]>;
  listMembers(): Promise<AdminMemberRow[]>;
  listVotes(): Promise<AdminVoteRow[]>;
  getRevealStage(): Promise<number>;
  /** 状態を from → to に変える。from と違っていたら、何も変えずに stale を返す(読んだ後の変更を上書きしない)。 */
  setVideoStatus(memberId: string, from: VideoStatus, to: VideoStatus): Promise<SetStatusOutcome>;
  setRevealStage(stage: number): Promise<void>;
  /** 全リセット:発表段階を 0 → 全動画を pending → 投票を全削除、の順に行う。削除した投票の件数を返す。 */
  resetAll(): Promise<{ deletedVotes: number }>;
}

export type ServiceResult = { status: number; body: Record<string, unknown> };

// ---------- エラー文(日本語。次に何をすればよいかを書く) ----------
const MESSAGES = {
  badRequest: "送信内容を読み取れませんでした。画面を更新して、もう一度お試しください。",
  badStage: "発表段階は 0〜3 の整数で指定してください。画面を更新して、もう一度お試しください。",
  notFound: "その動画が見つかりませんでした。画面を更新して、もう一度お試しください。",
  stale: "動画の状態が、画面を開いたあとに変わっていました。画面を更新して、もう一度お試しください。",
  conflictOpen: "ほかの動画が投票中です。先に、その動画を締め切ってください。",
  noNext: "開始できる未放映の動画がありません。",
  resetNeedsConfirm: `リセットするには、確認の合言葉「${RESET_CONFIRM_PHRASE}」を入力してください。`,
  resetFailed:
    "リセットの途中でエラーが起きました。もう一度「全データのリセット」を行ってください(何度行っても、結果は同じです)。",
  server: "サーバーでエラーが起きました。少し待ってから、もう一度お試しください。",
} as const;

const fail = (status: number, message: string, extra: Record<string, unknown> = {}): ServiceResult => ({
  status,
  body: { ok: false, error: message, ...extra },
});

// DB のエラーは、中身を利用者に見せない(ログには種類だけ残す)
function serverError(where: string, error: unknown, message: string = MESSAGES.server): ServiceResult {
  const detail = error instanceof Error ? error.message : "unknown";
  console.error(`[api/admin] ${where} 失敗: ${detail}`);
  return fail(500, message);
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// ---------- 1. いまの状態 ----------
export type AdminAction = { action: VideoAction; enabled: boolean; reason: string | null };

export async function getAdminStatus(repo: AdminRepo): Promise<ServiceResult> {
  try {
    const [videosRaw, members, votes, stage] = await Promise.all([
      repo.listVideos(),
      repo.listMembers(),
      repo.listVotes(),
      repo.getRevealStage(),
    ]);
    const videos = sortByRoster(videosRaw);
    const open = videos.find((v) => v.status === "open") ?? null;
    const eligibleCount = Math.max(members.length - 1, 0); // 自分の動画には投票しないので、持ち主を除く

    // 動画ごとの投票者(自分の動画への票は、集計から除外する)
    const votersByTarget = new Map<string, Set<string>>();
    for (const vote of votes) {
      if (vote.voterId === vote.targetId) continue;
      if (!votersByTarget.has(vote.targetId)) votersByTarget.set(vote.targetId, new Set());
      votersByTarget.get(vote.targetId)!.add(vote.voterId);
    }

    const rows = videos.map((v) => ({
      memberId: v.memberId,
      name: v.name,
      nameEn: v.nameEn,
      status: v.status,
      voteCount: votersByTarget.get(v.memberId)?.size ?? 0,
      eligibleCount,
      actions: allowedActions(v.status).map((action): AdminAction => {
        const opensIt = applyVideoAction(v.status, action) === "open";
        const blocked = opensIt && open !== null && open.memberId !== v.memberId;
        return {
          action,
          enabled: !blocked,
          reason: blocked ? `先に「${open!.name}」を締め切ってください` : null,
        };
      }),
    }));

    // いま投票中の動画:投票済み人数と、まだ投票していない人の名前(投票の内容は出さない)
    let openInfo: Record<string, unknown> | null = null;
    if (open) {
      const voted = votersByTarget.get(open.memberId) ?? new Set<string>();
      const notVotedNames = [...members]
        .filter((m) => m.id !== open.memberId && !voted.has(m.id))
        .sort((a, b) => compareRosterOrder(a.id, b.id))
        .map((m) => m.name);
      openInfo = {
        memberId: open.memberId,
        name: open.name,
        nameEn: open.nameEn,
        voteCount: voted.size,
        eligibleCount,
        notVotedNames,
      };
    }

    // 「締め切って次へ」:次に開く動画(いま投票中の動画が無いときは、最初の未放映)
    const nextId = pickNextVideo(
      videos.map((v) => ({ memberId: v.memberId, status: v.status === "open" ? ("closed" as const) : v.status })),
      open ? open.memberId : null,
    );
    const nextVideo = nextId ? videos.find((v) => v.memberId === nextId) ?? null : null;

    const rankedCount = computeRanking(
      videos.map((v) => ({ memberId: v.memberId, status: v.status })),
      votes,
    ).length;
    const currentStage = isValidRevealStage(stage) ? stage : 0;
    const warnings: RevealWarning[] = revealWarnings({
      videos,
      rankedCount,
      targetStage: Math.min(3, currentStage + 1), // 次の段階に進むときの警告
    });

    return {
      status: 200,
      body: {
        ok: true,
        videos: rows,
        open: openInfo,
        advance: {
          willClose: open !== null,
          closeName: open ? open.name : null,
          nextMemberId: nextVideo ? nextVideo.memberId : null,
          nextName: nextVideo ? nextVideo.name : null,
          canAdvance: open !== null || nextVideo !== null,
        },
        revealStage: currentStage,
        revealLabel: REVEAL_STAGE_LABELS[currentStage],
        warnings,
        rankedCount,
        totals: { members: members.length, votes: votes.length },
      },
    };
  } catch (error) {
    return serverError("状態の取得", error);
  }
}

// ---------- 2. 動画の状態の切替 ----------
export async function changeVideoStatus(repo: AdminRepo, raw: unknown): Promise<ServiceResult> {
  if (!isObject(raw)) return fail(400, MESSAGES.badRequest);
  const { action, memberId } = raw;

  try {
    // 「締め切って次へ」
    if (action === "advance") return await advance(repo);

    if (!isVideoAction(action) || typeof memberId !== "string" || memberId.length === 0 || memberId.length > 64) {
      return fail(400, MESSAGES.badRequest);
    }
    const videos = await repo.listVideos();
    const target = videos.find((v) => v.memberId === memberId);
    if (!target) return fail(404, MESSAGES.notFound);

    const next = applyVideoAction(target.status, action);
    if (next === null) {
      return fail(409, `「${target.name}」は、いま「${STATUS_LABELS[target.status]}」なので、この操作はできません。画面を更新して、もう一度お試しください。`);
    }
    const otherOpen = videos.find((v) => v.status === "open" && v.memberId !== memberId);
    if (next === "open" && otherOpen) {
      return fail(409, `「${otherOpen.name}」が投票中です。先に、その動画を締め切ってください。`);
    }

    const outcome = await repo.setVideoStatus(memberId, target.status, next);
    if (outcome === "stale") return fail(409, MESSAGES.stale);
    if (outcome === "conflict-open") return fail(409, MESSAGES.conflictOpen); // DB の制約(open は 1 本だけ)が止めた場合
    return { status: 200, body: { ok: true, memberId, status: next } };
  } catch (error) {
    return serverError("動画の状態の変更", error);
  }
}

/** 「締め切って次へ」:いま投票中の動画を締め切り、名簿順で次の未放映の動画を開く。 */
async function advance(repo: AdminRepo): Promise<ServiceResult> {
  const videos = await repo.listVideos();
  const open = videos.find((v) => v.status === "open") ?? null;

  if (!open) {
    const nextId = pickNextVideo(videos, null);
    const next = nextId ? videos.find((v) => v.memberId === nextId) : undefined;
    if (!next) return fail(409, MESSAGES.noNext);
    const outcome = await repo.setVideoStatus(next.memberId, "pending", "open");
    if (outcome === "stale") return fail(409, MESSAGES.stale);
    if (outcome === "conflict-open") return fail(409, MESSAGES.conflictOpen);
    return {
      status: 200,
      body: { ok: true, closed: null, opened: next.memberId, message: `「${next.name}」を開始しました。` },
    };
  }

  const closedOutcome = await repo.setVideoStatus(open.memberId, "open", "closed");
  if (closedOutcome !== "ok") return fail(409, MESSAGES.stale);

  const afterClose = videos.map((v) => (v.memberId === open.memberId ? { ...v, status: "closed" as const } : v));
  const nextId = pickNextVideo(afterClose, open.memberId);
  const next = nextId ? afterClose.find((v) => v.memberId === nextId) : undefined;
  if (!next) {
    return {
      status: 200,
      body: { ok: true, closed: open.memberId, opened: null, message: `「${open.name}」を締め切りました。次の未放映の動画はありません。` },
    };
  }

  const openedOutcome = await repo.setVideoStatus(next.memberId, "pending", "open");
  if (openedOutcome !== "ok") {
    // 締切までは済んだが、次を開けなかった(途中までの成功)
    return {
      status: 409,
      body: {
        ok: false,
        error: `「${open.name}」の締切までは済みましたが、次の動画を開始できませんでした。一覧から「開始」を押してください。`,
        closed: open.memberId,
        opened: null,
      },
    };
  }
  return {
    status: 200,
    body: {
      ok: true,
      closed: open.memberId,
      opened: next.memberId,
      message: `「${open.name}」を締め切り、「${next.name}」を開始しました。`,
    },
  };
}

// ---------- 3. 結果発表の段階 ----------
export async function changeRevealStage(repo: AdminRepo, raw: unknown): Promise<ServiceResult> {
  if (!isObject(raw)) return fail(400, MESSAGES.badRequest);
  if (!isValidRevealStage(raw.stage)) return fail(400, MESSAGES.badStage);
  const stage = raw.stage;
  try {
    await repo.setRevealStage(stage);
    const [videos, votes] = await Promise.all([repo.listVideos(), repo.listVotes()]);
    const rankedCount = computeRanking(
      videos.map((v) => ({ memberId: v.memberId, status: v.status })),
      votes,
    ).length;
    return {
      status: 200,
      body: {
        ok: true,
        revealStage: stage,
        revealLabel: REVEAL_STAGE_LABELS[stage],
        warnings: revealWarnings({ videos, rankedCount, targetStage: stage }), // 警告は出すが、止めはしない
      },
    };
  } catch (error) {
    return serverError("発表段階の変更", error);
  }
}

// ---------- 4. 全データのリセット ----------
export async function resetEverything(repo: AdminRepo, raw: unknown): Promise<ServiceResult> {
  // 確認の合言葉が無ければ、サーバー自身が断る(画面を経由しない呼び出しも防ぐ)
  if (!isObject(raw) || !isResetConfirmed(raw.confirm)) return fail(400, MESSAGES.resetNeedsConfirm);
  try {
    const { deletedVotes } = await repo.resetAll();
    return { status: 200, body: { ok: true, deletedVotes } };
  } catch (error) {
    return serverError("リセット", error, MESSAGES.resetFailed);
  }
}
