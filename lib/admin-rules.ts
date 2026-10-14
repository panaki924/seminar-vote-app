// 管理画面の「ルール」を集めた純粋関数。DB にも画面にも通信にも依存しない。
// → 状態の切替表・放映順・警告・リセットの確認語を、テストで確かめられる。
import type { VideoStatus } from "./ranking";

// ---------- 1. 動画の状態の切替表 ----------
export type VideoAction = "start" | "close" | "reopen" | "skip" | "restore";

const TRANSITIONS: Record<VideoAction, { from: readonly VideoStatus[]; to: VideoStatus }> = {
  start: { from: ["pending"], to: "open" }, // 開始
  close: { from: ["open"], to: "closed" }, // 締切
  reopen: { from: ["closed"], to: "open" }, // 再開(押し間違いの取り消し)
  skip: { from: ["pending", "open", "closed"], to: "not_shown" }, // 放映できない
  restore: { from: ["not_shown"], to: "pending" }, // 元に戻す
};

export const ACTION_LABELS: Record<VideoAction, string> = {
  start: "開始",
  close: "締切",
  reopen: "再開",
  skip: "放映できない",
  restore: "元に戻す",
};

export const STATUS_LABELS: Record<VideoStatus, string> = {
  pending: "未放映",
  open: "投票中",
  closed: "締切",
  not_shown: "放映不可",
};

export const ALL_ACTIONS = Object.keys(TRANSITIONS) as VideoAction[];

/** いまの状態に操作を行うと、次の状態は何か。許されない操作なら null。 */
export function applyVideoAction(current: VideoStatus, action: VideoAction): VideoStatus | null {
  const rule = TRANSITIONS[action];
  return rule && rule.from.includes(current) ? rule.to : null;
}

/** いまの状態で行える操作の一覧(画面のボタンの出し分けに使う)。 */
export function allowedActions(current: VideoStatus): VideoAction[] {
  return ALL_ACTIONS.filter((action) => applyVideoAction(current, action) !== null);
}

export function isVideoAction(value: unknown): value is VideoAction {
  return typeof value === "string" && (ALL_ACTIONS as string[]).includes(value);
}

// ---------- 2. 放映順(学籍番号順。S001 は最後) ----------
function rosterKey(id: string): { prefix: string; number: number; rest: string } {
  const m = /^([A-Za-z]*)(\d*)(.*)$/.exec(id) ?? [];
  return { prefix: (m[1] ?? "").toUpperCase(), number: m[2] ? Number(m[2]) : -1, rest: m[3] ?? "" };
}

/**
 * 名簿の並び順(学籍番号順)の比較。文字の部分(K → S)、数字の部分(数として)、残りの順に比べる。
 * 例:K0001 < K0009 < K0010 < S001
 */
export function compareRosterOrder(a: string, b: string): number {
  const x = rosterKey(a);
  const y = rosterKey(b);
  if (x.prefix !== y.prefix) return x.prefix < y.prefix ? -1 : 1;
  if (x.number !== y.number) return x.number - y.number;
  if (x.rest !== y.rest) return x.rest < y.rest ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortByRoster<T extends { memberId: string }>(items: readonly T[]): T[] {
  return [...items].sort((p, q) => compareRosterOrder(p.memberId, q.memberId));
}

/**
 * 「締め切って次へ」で開く、次の動画を選ぶ。
 *  ・名簿の学籍番号順(S001 は最後)に見て、afterMemberId より後ろにある pending(未放映)のうち、最初のもの。
 *  ・not_shown(放映不可)、closed、open は飛ばす。
 *  ・afterMemberId が null(いま投票中の動画がない)なら、名簿順で最初の pending。
 *  ・後ろに pending が無ければ null(前の方に戻ることはしない。戻したいときは、一覧から「開始」を押す)。
 */
export function pickNextVideo(
  videos: readonly { memberId: string; status: VideoStatus }[],
  afterMemberId: string | null,
): string | null {
  const sorted = sortByRoster(videos);
  const afterIndex = afterMemberId === null ? -1 : sorted.findIndex((v) => v.memberId === afterMemberId);
  // afterMemberId が一覧に無いときは、先頭から探す
  const start = afterMemberId === null || afterIndex === -1 ? 0 : afterIndex + 1;
  const next = sorted.slice(start).find((v) => v.status === "pending");
  return next ? next.memberId : null;
}

// ---------- 3. 結果発表の段階 ----------
export const REVEAL_STAGE_LABELS = ["非表示", "3位を公開中", "2位まで公開中", "1位まで公開中"] as const;

export function isValidRevealStage(value: unknown): value is 0 | 1 | 2 | 3 {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 3;
}

/** 段階を1つ進める(+1)・戻す(-1)。0〜3 の外には出ない。 */
export function stepRevealStage(current: number, delta: 1 | -1): 0 | 1 | 2 | 3 {
  const next = Math.min(3, Math.max(0, Math.trunc(current) + delta));
  return next as 0 | 1 | 2 | 3;
}

export type RevealWarning = { code: "unfinished-videos" | "few-ranked"; message: string };

/**
 * 発表する(段階を上げる)前の警告。止めはせず、画面に出すだけ。
 * 段階 0(非表示にする)のときは、警告しない。
 */
export function revealWarnings(input: {
  videos: readonly { memberId: string; status: VideoStatus }[];
  rankedCount: number;
  targetStage: number;
}): RevealWarning[] {
  if (input.targetStage <= 0) return [];
  const warnings: RevealWarning[] = [];
  const unfinished = input.videos.filter((v) => v.status === "pending" || v.status === "open").length;
  if (unfinished > 0) {
    warnings.push({
      code: "unfinished-videos",
      message: `締切前の動画が ${unfinished} 本残っています。このまま発表すると、あとから票が変わって順位が入れ替わることがあります。`,
    });
  }
  if (input.rankedCount < 3) {
    warnings.push({
      code: "few-ranked",
      message: `順位の対象が ${input.rankedCount} 名です(3位までそろいません)。`,
    });
  }
  return warnings;
}

// ---------- 4. リセットの確認語 ----------
export const RESET_CONFIRM_PHRASE = "リセット";

/** リセットの確認語が正しいか。前後の空白だけは許す。 */
export function isResetConfirmed(value: unknown): boolean {
  return typeof value === "string" && value.trim() === RESET_CONFIRM_PHRASE;
}
