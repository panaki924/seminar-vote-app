// 投票 API の中身(判断のロジック)。DB には直接触らず、VoteRepo という窓口だけを通す。
// → テストでは VoteRepo を偽物に差し替えて、本物の DB なしで動きを確かめられる。

// ---------- DB への窓口(本物は lib/vote-repo.ts、テストでは偽物) ----------
export type VoterRow = { id: string; name: string };
export type OpenVideoRow = { memberId: string; name: string; nameEn: string };
export type VoteRow = { tech: number; impact: number; updatedAt: string };

export interface VoteRepo {
  /** トークンに一致する参加者。無ければ null。 */
  findMemberByToken(token: string): Promise<VoterRow | null>;
  /** status='open' の動画。DB の制約で最大1本のはずだが、念のため最大2件まで返す。 */
  findOpenVideos(): Promise<OpenVideoRow[]>;
  /** 投票者が、その動画に送信済みの投票。無ければ null。 */
  findVote(voterId: string, targetId: string): Promise<VoteRow | null>;
  /** 投票を保存する。同じ(投票者, 対象)があれば上書きする。 */
  upsertVote(vote: {
    voterId: string;
    targetId: string;
    tech: number;
    impact: number;
    updatedAt: string;
  }): Promise<VoteRow>;
}

// ---------- 返す内容 ----------
export type ApiResult = { status: number; body: Record<string, unknown> };

export type VoteStateBody = {
  voter: { id: string; name: string };
  /** 投票中の動画。無ければ null。 */
  current: { videoId: string; name: string; nameEn: string; isOwn: boolean } | null;
  /** 送信済みの自分の投票(自分の動画・未送信なら null)。他人の投票は含まれない。 */
  myVote: VoteRow | null;
};

// ---------- エラー文(日本語。次に何をすればよいかを書く) ----------
const MESSAGES = {
  badToken:
    "本人確認できませんでした。配られたQRコードをもう一度読み取って、開き直してください。",
  badRequest: "送信内容を読み取れませんでした。画面を更新して、もう一度送信してください。",
  badScore: "点数は 1〜5 の整数で選んでください。",
  badTarget: "投票先を確認できませんでした。画面を更新して、もう一度送信してください。",
  selfVote: "あなたの動画には投票できません。",
  noOpen:
    "いま投票中の動画はありません(締切後か、まだ放映前です)。次の動画が始まるまでお待ちください。",
  switched:
    "投票中の動画が切り替わりました。画面を更新して、いまの動画に投票し直してください。",
  server: "サーバーでエラーが起きました。少し待ってから、もう一度お試しください。",
} as const;

const fail = (status: number, message: string): ApiResult => ({
  status,
  body: { ok: false, error: message },
});

// ---------- 入力のチェック ----------
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * トークンの形式をチェックする。
 * 形式が違う場合も、DB に無い場合も、呼び出し側では同じエラーにする(区別を教えない)。
 */
export function normalizeToken(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  return TOKEN_PATTERN.test(token) ? token : null;
}

/** 点数は 1〜5 の整数(数値型)だけ。小数・文字列・範囲外・null などは null を返す。 */
export function parseScore(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5
    ? value
    : null;
}

type ParsedBody =
  | { ok: true; targetId: string; tech: number; impact: number }
  | { ok: false; result: ApiResult };

function parseVoteBody(raw: unknown): ParsedBody {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, result: fail(400, MESSAGES.badRequest) };
  }
  // voterId など、ほかの項目が送られてきても無視する(投票者はトークンだけで決める)
  const { targetId, tech, impact } = raw as Record<string, unknown>;
  if (typeof targetId !== "string" || targetId.length === 0 || targetId.length > 64) {
    return { ok: false, result: fail(400, MESSAGES.badTarget) };
  }
  const techScore = parseScore(tech);
  const impactScore = parseScore(impact);
  if (techScore === null || impactScore === null) {
    return { ok: false, result: fail(400, MESSAGES.badScore) };
  }
  return { ok: true, targetId, tech: techScore, impact: impactScore };
}

// DB のエラーは中身を利用者に見せない(ログには種類だけ残す)
function serverError(where: string, error: unknown): ApiResult {
  const detail = error instanceof Error ? error.message : "unknown";
  console.error(`[api/vote] ${where} 失敗: ${detail}`);
  return fail(500, MESSAGES.server);
}

// ---------- 1. 本人確認 + 状態の取得 ----------
export async function getVoteState(
  repo: VoteRepo,
  tokenHeader: string | null | undefined,
): Promise<ApiResult> {
  const token = normalizeToken(tokenHeader);
  if (token === null) return fail(401, MESSAGES.badToken);

  try {
    const [voter, openVideos] = await Promise.all([
      repo.findMemberByToken(token),
      repo.findOpenVideos(),
    ]);
    if (voter === null) return fail(401, MESSAGES.badToken); // 形式違いと同じ文・同じ状態コード

    if (openVideos.length > 1) {
      // DB の制約で起きないはずの状態。起きたら投票を受け付けない。
      return serverError("open の動画が複数ある", new Error("multiple open videos"));
    }

    const open = openVideos[0];
    let current: VoteStateBody["current"] = null;
    let myVote: VoteRow | null = null;
    if (open) {
      const isOwn = open.memberId === voter.id;
      current = { videoId: open.memberId, name: open.name, nameEn: open.nameEn, isOwn };
      if (!isOwn) myVote = await repo.findVote(voter.id, open.memberId);
    }

    const body: VoteStateBody = { voter: { id: voter.id, name: voter.name }, current, myVote };
    return { status: 200, body: { ok: true, ...body } };
  } catch (error) {
    return serverError("状態の取得", error);
  }
}

// ---------- 2. 投票の送信(上書き可) ----------
export async function submitVote(
  repo: VoteRepo,
  tokenHeader: string | null | undefined,
  rawBody: unknown,
  now: Date = new Date(),
): Promise<ApiResult> {
  const token = normalizeToken(tokenHeader);
  if (token === null) return fail(401, MESSAGES.badToken);

  try {
    const voter = await repo.findMemberByToken(token);
    if (voter === null) return fail(401, MESSAGES.badToken);

    const parsed = parseVoteBody(rawBody);
    if (!parsed.ok) return parsed.result;
    const { targetId, tech, impact } = parsed;

    // 自己投票は、DB の CHECK 制約とは別に、ここでも拒否する
    if (targetId === voter.id) return fail(403, MESSAGES.selfVote);

    // 投票先は「いま open の動画」にサーバー側で決める。送られた targetId は照合にだけ使う。
    const openVideos = await repo.findOpenVideos();
    if (openVideos.length > 1) {
      return serverError("open の動画が複数ある", new Error("multiple open videos"));
    }
    const open = openVideos[0];
    if (!open) return fail(409, MESSAGES.noOpen); // 未放映・締切後・放映不可はここで拒否
    if (open.memberId !== targetId) return fail(409, MESSAGES.switched);
    if (open.memberId === voter.id) return fail(403, MESSAGES.selfVote); // 念のため(open 側のIDでも確認)

    const saved = await repo.upsertVote({
      voterId: voter.id, // トークンから決めた投票者
      targetId: open.memberId, // サーバーが決めた投票先
      tech,
      impact,
      updatedAt: now.toISOString(),
    });
    return { status: 200, body: { ok: true, myVote: saved } };
  } catch (error) {
    return serverError("投票の保存", error);
  }
}
