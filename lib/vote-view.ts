// 投票画面の「判断」だけを集めた純粋関数。画面(React)にも通信にも依存しない。
// → 「いまどの画面を出すか」「送信ボタンを押せるか」を、テストで確かめられる。

export type Score = 1 | 2 | 3 | 4 | 5;
export const SCORES: readonly Score[] = [1, 2, 3, 4, 5];

/** GET /api/vote が返す、画面に必要な状態。 */
export type VoteSnapshot = {
  voter: { id: string; name: string };
  current: { videoId: string; name: string; nameEn: string; isOwn: boolean } | null;
  myVote: { tech: number; impact: number; updatedAt: string } | null;
};

export type CurrentVideo = NonNullable<VoteSnapshot["current"]>;

// ---------- 1. いま、どの画面を出すか ----------
export type Screen =
  | { kind: "loading" }
  | { kind: "invalid-token"; message: string }
  | { kind: "waiting"; voterName: string }
  | { kind: "own-video"; voterName: string; video: CurrentVideo }
  | { kind: "form"; voterName: string; video: CurrentVideo; mode: "new" | "edit" }
  | { kind: "voted"; voterName: string; video: CurrentVideo; vote: NonNullable<VoteSnapshot["myVote"]> };

export function deriveScreen(input: {
  snapshot: VoteSnapshot | null;
  /** 本人確認できなかったとき(401)のメッセージ。あれば最優先で表示する。 */
  fatalMessage: string | null;
  /** 送信済みの内容を「変更する」ために開いているか。 */
  editing: boolean;
}): Screen {
  const { snapshot, fatalMessage, editing } = input;
  if (fatalMessage !== null) return { kind: "invalid-token", message: fatalMessage };
  if (snapshot === null) return { kind: "loading" };

  const voterName = snapshot.voter.name;
  const video = snapshot.current;
  if (video === null) return { kind: "waiting", voterName };
  if (video.isOwn) return { kind: "own-video", voterName, video }; // 自分の動画では投票欄を出さない

  if (snapshot.myVote !== null && !editing) {
    return { kind: "voted", voterName, video, vote: snapshot.myVote };
  }
  return { kind: "form", voterName, video, mode: snapshot.myVote !== null ? "edit" : "new" };
}

// ---------- 2. 入力中の点数(下書き) ----------
export type Draft = { tech: Score | null; impact: Score | null };
export type Criterion = "tech" | "impact";

/** 何も選んでいない状態。初期値は選ばない(押し忘れを防ぐため)。 */
export const emptyDraft = (): Draft => ({ tech: null, impact: null });

export function toScore(value: unknown): Score | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5
    ? (value as Score)
    : null;
}

/** 点数を1つ選ぶ。1〜5以外は、画面のバグなので例外にする。 */
export function setScore(draft: Draft, criterion: Criterion, value: number): Draft {
  const score = toScore(value);
  if (score === null) throw new RangeError(`点数は1〜5の整数です: ${value}`);
  return { ...draft, [criterion]: score };
}

/** 送信済みの内容から作る下書き(「変更する」を押したとき、前の点数を最初から選んだ状態にする)。 */
export function draftFromVote(vote: { tech: number; impact: number } | null): Draft {
  return vote ? { tech: toScore(vote.tech), impact: toScore(vote.impact) } : emptyDraft();
}

export const isDraftComplete = (draft: Draft): draft is { tech: Score; impact: Score } =>
  draft.tech !== null && draft.impact !== null;

/**
 * 送信ボタンを押せるか。
 *  ・2項目とも選ぶまでは押せない。
 *  ・送信済みの内容を変更するときは、前と違う点数を選んだときだけ押せる(同じ内容の再送信を防ぐ)。
 *  ・送信中は押せない(二重送信の防止)。
 */
export function canSubmit(
  draft: Draft,
  existing: { tech: number; impact: number } | null,
  sending: boolean,
): boolean {
  if (sending || !isDraftComplete(draft)) return false;
  if (existing === null) return true;
  return draft.tech !== existing.tech || draft.impact !== existing.impact;
}

/** 送信ボタンの下に出す案内文。押せるときは null。 */
export function submitHint(
  draft: Draft,
  existing: { tech: number; impact: number } | null,
  sending: boolean,
): string | null {
  if (sending) return "送信しています…";
  if (!isDraftComplete(draft)) {
    if (draft.tech === null && draft.impact === null) return "①と②の点数を選ぶと、送信できます";
    return draft.tech === null ? "①の点数を選ぶと、送信できます" : "②の点数を選ぶと、送信できます";
  }
  return canSubmit(draft, existing, false) ? null : "点数を変えると、送信できます";
}

// ---------- 3. 動画が切り替わったとき ----------
/** 投票中の動画が、別の動画に切り替わったか(どちらも動画があり、IDが違う)。 */
export function videoSwitched(previousId: string | null, nextId: string | null): boolean {
  return previousId !== null && nextId !== null && previousId !== nextId;
}

/**
 * 下書きを、いまの動画に合わせて返す。
 * 動画が同じなら入力中の下書きをそのまま残し(ポーリングで消さない)、違えば空に戻す。
 */
export function draftForVideo(
  draft: Draft,
  draftVideoId: string | null,
  currentVideoId: string | null,
): Draft {
  return currentVideoId !== null && draftVideoId === currentVideoId ? draft : emptyDraft();
}

// ---------- 4. 表示用の整形 ----------
/** 送信時刻を「12:34」の形(日本時間)にする。読み取れなければ空文字。 */
export function formatSentTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23", // 0〜23時表記(深夜0時台を『24:05』と出さない)
    timeZone: "Asia/Tokyo",
  }).format(date);
}

// ---------- 5. 評価項目の文言(CLAUDE.md の評価ルールに合わせる) ----------
export const CRITERIA: readonly { key: Criterion; title: string }[] = [
  { key: "tech", title: "① 動画の技術的水準と完成度" },
  { key: "impact", title: "② 自己紹介としてのインパクト" },
];
export const SCALE_LOW_LABEL = "低い";
export const SCALE_HIGH_LABEL = "高い";
