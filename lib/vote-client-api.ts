// ブラウザから /api/vote を呼ぶための、薄い通信の部品。
// ・本人確認のトークンは、URL ではなく x-vote-token ヘッダーで送る。
// ・返事の形を確かめてから画面に渡す(想定外の返事で画面が壊れないように)。
import type { VoteSnapshot } from "./vote-view";

const ENDPOINT = "/api/vote";
const TOKEN_HEADER = "x-vote-token";

export const NETWORK_ERROR_MESSAGE =
  "通信できませんでした。電波の良い場所で、少し待ってからもう一度お試しください。";
const UNEXPECTED_MESSAGE = "サーバーの返事を読み取れませんでした。画面を更新してください。";

export type FetchStateResult =
  | { kind: "ok"; snapshot: VoteSnapshot }
  | { kind: "unauthorized"; message: string } // 401:このトークンでは本人確認できない(再試行しても同じ)
  | { kind: "error"; message: string }; // 通信の失敗・サーバーの不調(あとで再試行できる)

export type SubmitResult =
  | { kind: "ok"; vote: { tech: number; impact: number; updatedAt: string } }
  | { kind: "rejected"; status: number; message: string } // 400 / 403 / 409:内容や状況が合わない
  | { kind: "unauthorized"; message: string }
  | { kind: "error"; message: string };

type Options = { signal?: AbortSignal; fetchImpl?: typeof fetch };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseVote(value: unknown): { tech: number; impact: number; updatedAt: string } | null {
  if (!isObject(value)) return null;
  const { tech, impact, updatedAt } = value;
  return typeof tech === "number" && typeof impact === "number" && typeof updatedAt === "string"
    ? { tech, impact, updatedAt }
    : null;
}

/** 返事の JSON が、画面に渡してよい形か確かめる。違えば null。 */
export function parseSnapshot(json: unknown): VoteSnapshot | null {
  if (!isObject(json) || json.ok !== true || !isObject(json.voter)) return null;
  const { id, name } = json.voter;
  if (typeof id !== "string" || typeof name !== "string") return null;

  let current: VoteSnapshot["current"] = null;
  if (json.current !== null) {
    if (!isObject(json.current)) return null;
    const { videoId, name: videoName, nameEn, isOwn } = json.current;
    if (
      typeof videoId !== "string" ||
      typeof videoName !== "string" ||
      typeof nameEn !== "string" ||
      typeof isOwn !== "boolean"
    ) {
      return null;
    }
    current = { videoId, name: videoName, nameEn, isOwn };
  }

  let myVote: VoteSnapshot["myVote"] = null;
  if (json.myVote !== null) {
    myVote = parseVote(json.myVote);
    if (myVote === null) return null;
  }
  return { voter: { id, name }, current, myVote };
}

function errorMessageOf(json: unknown, fallback: string): string {
  return isObject(json) && typeof json.error === "string" && json.error ? json.error : fallback;
}

async function request(
  token: string,
  init: { method: "GET" | "POST"; body?: unknown },
  { signal, fetchImpl = fetch }: Options,
): Promise<{ status: number; json: unknown }> {
  const response = await fetchImpl(ENDPOINT, {
    method: init.method,
    headers: {
      [TOKEN_HEADER]: token,
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store", // いつも最新を取る
    signal,
  });
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // JSON でない返事は、status だけで判断する
  }
  return { status: response.status, json };
}

/** いまの状態を取得する(ポーリングで繰り返し呼ぶ)。中断(abort)されたときは例外を投げる。 */
export async function fetchVoteState(token: string, options: Options = {}): Promise<FetchStateResult> {
  let res: { status: number; json: unknown };
  try {
    res = await request(token, { method: "GET" }, options);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return { kind: "error", message: NETWORK_ERROR_MESSAGE };
  }
  if (res.status === 401) return { kind: "unauthorized", message: errorMessageOf(res.json, UNEXPECTED_MESSAGE) };
  if (res.status === 200) {
    const snapshot = parseSnapshot(res.json);
    return snapshot ? { kind: "ok", snapshot } : { kind: "error", message: UNEXPECTED_MESSAGE };
  }
  return { kind: "error", message: errorMessageOf(res.json, UNEXPECTED_MESSAGE) };
}

/** 投票を送信する。 */
export async function submitVoteRequest(
  token: string,
  vote: { targetId: string; tech: number; impact: number },
  options: Options = {},
): Promise<SubmitResult> {
  let res: { status: number; json: unknown };
  try {
    res = await request(token, { method: "POST", body: vote }, options);
  } catch {
    return { kind: "error", message: NETWORK_ERROR_MESSAGE };
  }
  if (res.status === 200 && isObject(res.json) && res.json.ok === true) {
    const saved = parseVote(res.json.myVote);
    if (saved) return { kind: "ok", vote: saved };
    return { kind: "error", message: UNEXPECTED_MESSAGE };
  }
  const message = errorMessageOf(res.json, UNEXPECTED_MESSAGE);
  if (res.status === 401) return { kind: "unauthorized", message };
  if (res.status === 400 || res.status === 403 || res.status === 409) {
    return { kind: "rejected", status: res.status, message };
  }
  return { kind: "error", message };
}
