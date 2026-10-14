// 管理画面の「判断」だけを集めた純粋関数。画面(React)にも通信にも依存しない。
// → ボタンの文言・押せるか・確認ダイアログの条件を、テストで確かめられる。
import {
  ACTION_LABELS,
  isResetConfirmed,
  RESET_CONFIRM_PHRASE,
  STATUS_LABELS,
  type RevealWarning,
  type VideoAction,
} from "./admin-rules";
import type { VideoStatus } from "./ranking";

// ---------- GET /api/admin/status の返事の形 ----------
export type AdminActionItem = { action: VideoAction; enabled: boolean; reason: string | null };
export type AdminVideoItem = {
  memberId: string;
  name: string;
  nameEn: string;
  status: VideoStatus;
  voteCount: number;
  eligibleCount: number;
  actions: AdminActionItem[];
};
export type AdminOpenInfo = {
  memberId: string;
  name: string;
  nameEn: string;
  voteCount: number;
  eligibleCount: number;
  notVotedNames: string[];
};
export type AdminAdvanceInfo = {
  willClose: boolean;
  closeName: string | null;
  nextMemberId: string | null;
  nextName: string | null;
  canAdvance: boolean;
};
export type AdminStatus = {
  videos: AdminVideoItem[];
  open: AdminOpenInfo | null;
  advance: AdminAdvanceInfo;
  revealStage: 0 | 1 | 2 | 3;
  revealLabel: string;
  warnings: RevealWarning[];
  rankedCount: number;
  totals: { members: number; votes: number };
};

// ---------- 1. 「締め切って次へ」のボタン ----------
export function advanceButton(advance: AdminAdvanceInfo): { label: string; enabled: boolean } {
  if (advance.willClose) {
    return advance.nextName
      ? { label: `締め切って次へ(次:${advance.nextName})`, enabled: true }
      : { label: "締め切る(次の未放映の動画はありません)", enabled: true };
  }
  return advance.nextName
    ? { label: `最初の動画を開始(${advance.nextName})`, enabled: true }
    : { label: "開始できる動画がありません", enabled: false };
}

// ---------- 2. 投票の進み具合 ----------
export function voteProgress(voteCount: number, eligibleCount: number): { text: string; percent: number; complete: boolean } {
  const percent = eligibleCount > 0 ? Math.min(100, Math.round((voteCount / eligibleCount) * 100)) : 0;
  return {
    text: `投票済み ${voteCount} / ${eligibleCount} 人`,
    percent,
    complete: eligibleCount > 0 && voteCount >= eligibleCount,
  };
}

/**
 * 「まだ投票していない人」の見せ方。
 * 名前は、表示にしたときだけ画面に描く(非表示のときは、人数だけ。映したときに、名前が全員に見えないように)。
 */
export function notVotedDisplay(
  names: readonly string[],
  shown: boolean,
): { text: string; canToggle: boolean; toggleLabel: string } {
  if (names.length === 0) return { text: "全員が投票済みです。", canToggle: false, toggleLabel: "" };
  return shown
    ? { text: `まだ投票していない人:${names.join("、")}`, canToggle: true, toggleLabel: "名前を隠す" }
    : { text: `まだ投票していない人:${names.length} 人(名前は非表示)`, canToggle: true, toggleLabel: "名前を表示する" };
}

/**
 * 取得した状態に合わせて、「名前を表示している動画」の記憶を更新する。
 * 投票中の動画が変わったら(別の動画になった・投票中の動画がなくなった)、記憶を消して、非表示に戻す。
 * 一度消したら、同じ動画がまた投票中になっても、名前は勝手に出ない(映したまま、名前が再び出ないように)。
 */
export function namesShownAfterStatus(
  shownFor: string | null,
  previousOpenId: string | null,
  nextOpenId: string | null,
): string | null {
  return previousOpenId === nextOpenId ? shownFor : null;
}

// ---------- 3. 状態・操作の見せ方 ----------
export type Tone = "primary" | "neutral" | "danger";

export function statusLabel(status: VideoStatus): string {
  return STATUS_LABELS[status];
}

/** 操作ボタンの種類(色分け用)。放映できない、は目立たせすぎない赤系。 */
export function actionTone(action: VideoAction): Tone {
  switch (action) {
    case "start":
      return "primary";
    case "skip":
      return "danger";
    default:
      return "neutral";
  }
}

export function actionLabel(action: VideoAction): string {
  return ACTION_LABELS[action];
}

/** 操作が成功したときに画面に出す文。 */
export function actionResultMessage(action: VideoAction, name: string): string {
  switch (action) {
    case "start":
      return `「${name}」を開始しました。`;
    case "close":
      return `「${name}」を締め切りました。`;
    case "reopen":
      return `「${name}」の投票を再開しました。`;
    case "skip":
      return `「${name}」を放映不可にしました。順位の対象から外れます。`;
    case "restore":
      return `「${name}」を未放映に戻しました。`;
  }
}

// ---------- 4. 結果発表のボタン ----------
export type RevealControls = {
  next: { enabled: boolean; targetStage: number; label: string };
  back: { enabled: boolean; targetStage: number; label: string };
  hide: { enabled: boolean; targetStage: 0; label: string };
};

const NEXT_LABELS = ["3位を発表する", "2位まで発表する", "1位まで発表する"] as const;

export function revealControls(stage: number): RevealControls {
  const current = Math.min(3, Math.max(0, Math.trunc(stage)));
  return {
    next: {
      enabled: current < 3,
      targetStage: Math.min(3, current + 1),
      label: current < 3 ? NEXT_LABELS[current] : "すべて発表済みです",
    },
    back: { enabled: current > 0, targetStage: Math.max(0, current - 1), label: "ひとつ戻す" },
    hide: { enabled: current > 0, targetStage: 0, label: "非表示にする" },
  };
}

// ---------- 5. 全データのリセットの確認ダイアログ ----------
export const RESET_PHRASE = RESET_CONFIRM_PHRASE;

/** 確認の合言葉を、正しく入力したか(これが true になるまで、「リセットする」は押せない)。 */
export function canConfirmReset(typed: string, submitting: boolean): boolean {
  return !submitting && isResetConfirmed(typed);
}

/** ダイアログに出す、「何が起きるか」の説明(件数つき)。 */
export function resetSummary(totals: { votes: number }): string[] {
  return [
    `投票 ${totals.votes} 件を、すべて削除します。`,
    "すべての動画を「未放映」に戻します。",
    "結果の発表段階を「非表示」に戻します。",
    "参加者の名簿と、配ったQRコード(本人確認のトークン)は、そのまま使えます。",
    "この操作は、元に戻せません。",
  ];
}

// ---------- 6. 時間の表示 ----------
/** 待ち時間の表示:60秒未満は「N秒」、それ以上は「約N分」。 */
export function formatWait(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return s < 60 ? `${s}秒` : `約${Math.ceil(s / 60)}分`;
}

/**
 * ログインが止められているときの案内文。残り時間は、この文の中の1か所だけに出す。
 * サーバーの文の最後にある「約 N 分後に、もう一度お試しください。」は、取り除く
 * (画面は残り時間を1秒ずつ数えているので、サーバーが返した時点の「約 N 分」と重なってしまうため)。
 */
export function lockNotice(serverMessage: string, remainingSec: number): string {
  const reason = serverMessage.replace(/\s*約\s*\d+\s*分後に、?もう一度お試しください。?\s*$/, "").trim();
  const wait = `あと${formatWait(remainingSec)}ほど、お待ちください。`;
  return reason ? `${reason} ${wait}` : wait;
}

// ---------- 7. お知らせの自動消去 ----------
export const SUCCESS_AUTO_DISMISS_MS = 5000;

/** お知らせが、何ミリ秒後に自動で消えるか。成功だけが消える。失敗・注意(警告つき)は、読み終わるまで残す。 */
export function feedbackAutoDismissMs(tone: "success" | "error" | "info"): number | null {
  return tone === "success" ? SUCCESS_AUTO_DISMISS_MS : null;
}
