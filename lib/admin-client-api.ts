// ブラウザから /api/admin/* を呼ぶための、薄い通信の部品。
// ・認証は、サーバーが渡した HttpOnly の Cookie(ブラウザが自動で付ける)。ここではパスワードもトークンも保存しない。
// ・返事の形を確かめてから画面に渡す(想定外の返事で画面が壊れないように)。
import type { RevealWarning, VideoAction } from "./admin-rules";
import type { VideoStatus } from "./ranking";
import type { AdminStatus } from "./admin-view";

const ENDPOINT = "/api/admin";

export const NETWORK_ERROR_MESSAGE =
  "通信できませんでした。電波やネットワークを確かめて、少し待ってからもう一度お試しください。";
const UNEXPECTED_MESSAGE = "サーバーの返事を読み取れませんでした。画面を更新してください。";

/** ログイン以外の呼び出しの結果。 */
export type AdminResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "unauthorized"; message: string } // 401:ログインしていない・期限切れ
  | { kind: "rejected"; status: number; message: string } // 400 / 403 / 404 / 409 / 503:内容や状況が合わない
  | { kind: "error"; message: string }; // 通信の失敗・サーバーの不調

export type LoginResult =
  | { kind: "ok" }
  | { kind: "wrong"; message: string } // 401:パスワードが違う
  | { kind: "locked"; message: string; retryAfterSec: number } // 429:失敗が続いて、止められている
  | { kind: "rejected"; status: number; message: string } // 403 / 503 など
  | { kind: "error"; message: string };

type Options = { signal?: AbortSignal; fetchImpl?: typeof fetch };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isNonNegInt = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

const STATUSES: readonly VideoStatus[] = ["pending", "open", "closed", "not_shown"];
const ACTIONS: readonly VideoAction[] = ["start", "close", "reopen", "skip", "restore"];

// ---------- 返事の形の確認 ----------
function parseWarnings(value: unknown): RevealWarning[] | null {
  if (!Array.isArray(value)) return null;
  const warnings: RevealWarning[] = [];
  for (const w of value) {
    if (!isObject(w) || !isString(w.message) || (w.code !== "unfinished-videos" && w.code !== "few-ranked")) return null;
    warnings.push({ code: w.code, message: w.message });
  }
  return warnings;
}

/** GET /api/admin/status の返事が、画面に渡してよい形か確かめる。違えば null。 */
export function parseAdminStatus(json: unknown): AdminStatus | null {
  if (!isObject(json) || json.ok !== true || !Array.isArray(json.videos)) return null;

  const videos: AdminStatus["videos"] = [];
  for (const v of json.videos) {
    if (!isObject(v) || !isString(v.memberId) || !isString(v.name) || !isString(v.nameEn)) return null;
    if (!STATUSES.includes(v.status as VideoStatus) || !isNonNegInt(v.voteCount) || !isNonNegInt(v.eligibleCount)) return null;
    if (!Array.isArray(v.actions)) return null;
    const actions: AdminStatus["videos"][number]["actions"] = [];
    for (const a of v.actions) {
      if (!isObject(a) || !ACTIONS.includes(a.action as VideoAction) || typeof a.enabled !== "boolean") return null;
      if (a.reason !== null && !isString(a.reason)) return null;
      actions.push({ action: a.action as VideoAction, enabled: a.enabled, reason: a.reason as string | null });
    }
    videos.push({
      memberId: v.memberId,
      name: v.name,
      nameEn: v.nameEn,
      status: v.status as VideoStatus,
      voteCount: v.voteCount,
      eligibleCount: v.eligibleCount,
      actions,
    });
  }

  let open: AdminStatus["open"] = null;
  if (json.open !== null) {
    const o = json.open;
    if (
      !isObject(o) ||
      !isString(o.memberId) ||
      !isString(o.name) ||
      !isString(o.nameEn) ||
      !isNonNegInt(o.voteCount) ||
      !isNonNegInt(o.eligibleCount) ||
      !Array.isArray(o.notVotedNames) ||
      !o.notVotedNames.every(isString)
    ) {
      return null;
    }
    open = {
      memberId: o.memberId,
      name: o.name,
      nameEn: o.nameEn,
      voteCount: o.voteCount,
      eligibleCount: o.eligibleCount,
      notVotedNames: o.notVotedNames as string[],
    };
  }

  const adv = json.advance;
  if (
    !isObject(adv) ||
    typeof adv.willClose !== "boolean" ||
    typeof adv.canAdvance !== "boolean" ||
    (adv.closeName !== null && !isString(adv.closeName)) ||
    (adv.nextMemberId !== null && !isString(adv.nextMemberId)) ||
    (adv.nextName !== null && !isString(adv.nextName))
  ) {
    return null;
  }

  const stage = json.revealStage;
  if (stage !== 0 && stage !== 1 && stage !== 2 && stage !== 3) return null;
  const warnings = parseWarnings(json.warnings);
  const totals = json.totals;
  if (
    !warnings ||
    !isString(json.revealLabel) ||
    !isNonNegInt(json.rankedCount) ||
    !isObject(totals) ||
    !isNonNegInt(totals.members) ||
    !isNonNegInt(totals.votes)
  ) {
    return null;
  }

  return {
    videos,
    open,
    advance: {
      willClose: adv.willClose,
      closeName: adv.closeName as string | null,
      nextMemberId: adv.nextMemberId as string | null,
      nextName: adv.nextName as string | null,
      canAdvance: adv.canAdvance,
    },
    revealStage: stage,
    revealLabel: json.revealLabel,
    warnings,
    rankedCount: json.rankedCount,
    totals: { members: totals.members, votes: totals.votes },
  };
}

// ---------- 通信の共通部分 ----------
async function request(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
  { signal, fetchImpl = fetch }: Options,
): Promise<{ status: number; json: unknown; headers: Headers }> {
  const response = await fetchImpl(`${ENDPOINT}/${path}`, {
    method: init.method,
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store", // いつも最新を取る
    credentials: "same-origin", // 同じサイトの Cookie(ログインの印)だけを送る
    signal,
  });
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // JSON でない返事は、status だけで判断する
  }
  return { status: response.status, json, headers: response.headers };
}

const messageOf = (json: unknown, fallback: string): string =>
  isObject(json) && isString(json.error) && json.error ? json.error : fallback;

/** ログイン以外の呼び出しで共通の、結果の分類。ok のときの中身は、呼び出し側が決める。 */
async function call<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
  options: Options,
  onOk: (json: unknown) => T | null,
): Promise<AdminResult<T>> {
  let res: Awaited<ReturnType<typeof request>>;
  try {
    res = await request(path, init, options);
  } catch (error) {
    if (options.signal?.aborted) throw error; // 中断(画面を離れた)は、通信エラーにしない
    return { kind: "error", message: NETWORK_ERROR_MESSAGE };
  }
  if (res.status === 401) return { kind: "unauthorized", message: messageOf(res.json, UNEXPECTED_MESSAGE) };
  if (res.status === 200) {
    const data = onOk(res.json);
    return data === null ? { kind: "error", message: UNEXPECTED_MESSAGE } : { kind: "ok", data };
  }
  if ([400, 403, 404, 409, 503].includes(res.status)) {
    return { kind: "rejected", status: res.status, message: messageOf(res.json, UNEXPECTED_MESSAGE) };
  }
  return { kind: "error", message: messageOf(res.json, UNEXPECTED_MESSAGE) };
}

// ---------- 各 API ----------
export const fetchAdminStatus = (options: Options = {}) =>
  call("status", { method: "GET" }, options, parseAdminStatus);

export type VideoRequest = { action: "advance" } | { memberId: string; action: VideoAction };
export type VideoChange = { message: string | null; closed: string | null; opened: string | null };

export const changeVideo = (body: VideoRequest, options: Options = {}) =>
  call<VideoChange>("videos", { method: "POST", body }, options, (json) => {
    if (!isObject(json) || json.ok !== true) return null;
    return {
      message: isString(json.message) ? json.message : null,
      closed: isString(json.closed) ? json.closed : null,
      opened: isString(json.opened) ? json.opened : null,
    };
  });

export type RevealChange = { revealStage: number; revealLabel: string; warnings: RevealWarning[] };

export const changeReveal = (stage: number, options: Options = {}) =>
  call<RevealChange>("reveal", { method: "POST", body: { stage } }, options, (json) => {
    if (!isObject(json) || json.ok !== true || !isNonNegInt(json.revealStage) || !isString(json.revealLabel)) return null;
    const warnings = parseWarnings(json.warnings);
    return warnings ? { revealStage: json.revealStage, revealLabel: json.revealLabel, warnings } : null;
  });

export const resetEverythingRequest = (confirm: string, options: Options = {}) =>
  call<{ deletedVotes: number }>("reset", { method: "POST", body: { confirm } }, options, (json) =>
    isObject(json) && json.ok === true && isNonNegInt(json.deletedVotes) ? { deletedVotes: json.deletedVotes } : null,
  );

export const logoutRequest = (options: Options = {}) =>
  call<true>("logout", { method: "POST", body: {} }, options, (json) => (isObject(json) && json.ok === true ? true : null));

export async function loginRequest(password: string, options: Options = {}): Promise<LoginResult> {
  let res: Awaited<ReturnType<typeof request>>;
  try {
    res = await request("login", { method: "POST", body: { password } }, options);
  } catch {
    return { kind: "error", message: NETWORK_ERROR_MESSAGE };
  }
  if (res.status === 200 && isObject(res.json) && res.json.ok === true) return { kind: "ok" };
  const message = messageOf(res.json, UNEXPECTED_MESSAGE);
  if (res.status === 401) return { kind: "wrong", message };
  if (res.status === 429) {
    const header = Number(res.headers.get("retry-after"));
    return { kind: "locked", message, retryAfterSec: Number.isFinite(header) && header > 0 ? header : 60 };
  }
  if (res.status === 403 || res.status === 503) return { kind: "rejected", status: res.status, message };
  return { kind: "error", message };
}
