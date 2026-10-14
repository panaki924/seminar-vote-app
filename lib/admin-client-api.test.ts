import { describe, expect, it, vi } from "vitest";
import {
  changeReveal,
  changeVideo,
  fetchAdminStatus,
  loginRequest,
  logoutRequest,
  NETWORK_ERROR_MESSAGE,
  parseAdminStatus,
  resetEverythingRequest,
} from "./admin-client-api";

const validStatus = () => ({
  ok: true,
  videos: [
    {
      memberId: "K0001",
      name: "織田信長",
      nameEn: "Oda Nobunaga",
      status: "closed",
      voteCount: 9,
      eligibleCount: 9,
      actions: [
        { action: "reopen", enabled: false, reason: "先に「豊臣秀吉」を締め切ってください" },
        { action: "skip", enabled: true, reason: null },
      ],
    },
    {
      memberId: "K0002",
      name: "豊臣秀吉",
      nameEn: "Toyotomi Hideyoshi",
      status: "open",
      voteCount: 3,
      eligibleCount: 9,
      actions: [{ action: "close", enabled: true, reason: null }],
    },
  ],
  open: { memberId: "K0002", name: "豊臣秀吉", nameEn: "Toyotomi Hideyoshi", voteCount: 3, eligibleCount: 9, notVotedNames: ["徳川家康"] },
  advance: { willClose: true, closeName: "豊臣秀吉", nextMemberId: "K0003", nextName: "徳川家康", canAdvance: true },
  revealStage: 1,
  revealLabel: "3位を公開中",
  warnings: [{ code: "unfinished-videos", message: "締切前の動画が残っています。" }],
  rankedCount: 2,
  totals: { members: 10, votes: 12 },
});

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const fetchReturning = (response: Response | (() => Promise<Response>)) =>
  vi.fn(async () => (typeof response === "function" ? response() : response)) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
type FetchCall = [string, RequestInit];
const callsOf = (f: unknown) => (f as { mock: { calls: FetchCall[] } }).mock.calls;

describe("parseAdminStatus(返事の形を確かめる)", () => {
  it("正しい形なら、画面に渡す状態に変える", () => {
    const status = parseAdminStatus(validStatus());
    expect(status).not.toBeNull();
    expect(status!.videos).toHaveLength(2);
    expect(status!.videos[0].actions[0]).toEqual({ action: "reopen", enabled: false, reason: "先に「豊臣秀吉」を締め切ってください" });
    expect(status!.open?.notVotedNames).toEqual(["徳川家康"]);
    expect(status!.revealStage).toBe(1);
    expect(status!.warnings).toEqual([{ code: "unfinished-videos", message: "締切前の動画が残っています。" }]);
    expect(status!.totals).toEqual({ members: 10, votes: 12 });
  });

  it("投票中の動画なし(open=null)も正しい形", () => {
    expect(parseAdminStatus({ ...validStatus(), open: null })?.open).toBeNull();
  });

  it.each([
    ["オブジェクトでない", "text"],
    ["null", null],
    ["ok が true でない", { ...validStatus(), ok: false }],
    ["videos が配列でない", { ...validStatus(), videos: "x" }],
    ["動画の状態が未知", (() => { const s = validStatus(); (s.videos[0] as { status: string }).status = "unknown"; return s; })()],
    ["動画の票数が負", (() => { const s = validStatus(); s.videos[0].voteCount = -1; return s; })()],
    ["操作が未知", (() => { const s = validStatus(); (s.videos[0].actions[0] as { action: string }).action = "delete"; return s; })()],
    ["操作の enabled が真偽値でない", (() => { const s = validStatus(); (s.videos[0].actions[0] as { enabled: unknown }).enabled = "yes"; return s; })()],
    ["open の未投票の名前が文字列でない", { ...validStatus(), open: { ...validStatus().open, notVotedNames: [1] } }],
    ["advance が無い", { ...validStatus(), advance: undefined }],
    ["発表段階が範囲外", { ...validStatus(), revealStage: 4 }],
    ["警告の種類が未知", { ...validStatus(), warnings: [{ code: "other", message: "x" }] }],
    ["合計が無い", { ...validStatus(), totals: undefined }],
  ])("形が違う(%s)なら null", (_label, json) => {
    expect(parseAdminStatus(json)).toBeNull();
  });
});

describe("共通の送り方", () => {
  it("GET:同じサイトの Cookie だけを送る・キャッシュしない・パスワードやトークンを URL やヘッダーに入れない", async () => {
    const fetchImpl = fetchReturning(reply(200, validStatus()));
    await fetchAdminStatus({ fetchImpl });
    const [url, init] = callsOf(fetchImpl)[0];
    expect(url).toBe("/api/admin/status");
    expect(init.method).toBe("GET");
    expect(init.cache).toBe("no-store");
    expect(init.credentials).toBe("same-origin");
    expect(init.headers).toBeUndefined();
  });

  it("POST:本文は JSON。同じサイトの Cookie だけを送る", async () => {
    const fetchImpl = fetchReturning(reply(200, { ok: true, memberId: "K0002", status: "open" }));
    await changeVideo({ memberId: "K0002", action: "start" }, { fetchImpl });
    const [url, init] = callsOf(fetchImpl)[0];
    expect(url).toBe("/api/admin/videos");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ memberId: "K0002", action: "start" });
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(init.credentials).toBe("same-origin");
  });
});

describe("fetchAdminStatus", () => {
  it("200 で正しい形なら ok", async () => {
    const result = await fetchAdminStatus({ fetchImpl: fetchReturning(reply(200, validStatus())) });
    expect(result.kind).toBe("ok");
  });

  it("401 は unauthorized(サーバーのメッセージつき)", async () => {
    const result = await fetchAdminStatus({ fetchImpl: fetchReturning(reply(401, { ok: false, error: "ログインしていません。" })) });
    expect(result).toEqual({ kind: "unauthorized", message: "ログインしていません。" });
  });

  it("503(設定の不備)・403 は rejected", async () => {
    for (const status of [503, 403]) {
      const result = await fetchAdminStatus({ fetchImpl: fetchReturning(reply(status, { ok: false, error: "理由の文" })) });
      expect(result).toEqual({ kind: "rejected", status, message: "理由の文" });
    }
  });

  it("500 と通信エラーは、あとで再試行できる error", async () => {
    expect((await fetchAdminStatus({ fetchImpl: fetchReturning(reply(500, { ok: false, error: "サーバーでエラー" })) })).kind).toBe("error");
    expect(await fetchAdminStatus({ fetchImpl: fetchReturning(() => Promise.reject(new TypeError("offline"))) })).toEqual({
      kind: "error",
      message: NETWORK_ERROR_MESSAGE,
    });
  });

  it("200 でも形が違えば error(画面を壊さない)", async () => {
    expect((await fetchAdminStatus({ fetchImpl: fetchReturning(reply(200, { ok: true })) })).kind).toBe("error");
  });

  it("JSON でない返事でも、例外にせず error", async () => {
    const res = await fetchAdminStatus({ fetchImpl: fetchReturning(new Response("<html>bad gateway</html>", { status: 502 })) });
    expect(res.kind).toBe("error");
  });

  it("中断(abort)されたときは、通信エラーにせず例外のまま伝える", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = fetchReturning(() => Promise.reject(new DOMException("aborted", "AbortError")));
    await expect(fetchAdminStatus({ fetchImpl, signal: controller.signal })).rejects.toThrow();
  });
});

describe("操作の結果(videos・reveal・reset・logout)", () => {
  it("changeVideo:締め切って次へ(advance)の返事を読む", async () => {
    const fetchImpl = fetchReturning(reply(200, { ok: true, closed: "K0002", opened: "K0003", message: "締め切り、開始しました。" }));
    expect(await changeVideo({ action: "advance" }, { fetchImpl })).toEqual({
      kind: "ok",
      data: { message: "締め切り、開始しました。", closed: "K0002", opened: "K0003" },
    });
    expect(JSON.parse(callsOf(fetchImpl)[0][1].body as string)).toEqual({ action: "advance" });
  });

  it.each([400, 403, 404, 409, 503])("changeVideo:%i は rejected(メッセージつき)", async (status) => {
    const result = await changeVideo({ memberId: "K0002", action: "start" }, { fetchImpl: fetchReturning(reply(status, { ok: false, error: "先に締め切ってください" })) });
    expect(result).toEqual({ kind: "rejected", status, message: "先に締め切ってください" });
  });

  it("changeVideo:401 は unauthorized、500 は error", async () => {
    expect((await changeVideo({ action: "advance" }, { fetchImpl: fetchReturning(reply(401, { ok: false, error: "x" })) })).kind).toBe("unauthorized");
    expect((await changeVideo({ action: "advance" }, { fetchImpl: fetchReturning(reply(500, { ok: false, error: "x" })) })).kind).toBe("error");
  });

  it("changeReveal:発表段階と警告を読む。本文は { stage }", async () => {
    const fetchImpl = fetchReturning(
      reply(200, { ok: true, revealStage: 2, revealLabel: "2位まで公開中", warnings: [{ code: "few-ranked", message: "順位の対象が 2 名です。" }] }),
    );
    const result = await changeReveal(2, { fetchImpl });
    expect(result).toEqual({
      kind: "ok",
      data: { revealStage: 2, revealLabel: "2位まで公開中", warnings: [{ code: "few-ranked", message: "順位の対象が 2 名です。" }] },
    });
    expect(JSON.parse(callsOf(fetchImpl)[0][1].body as string)).toEqual({ stage: 2 });
  });

  it("changeReveal:200 でも形が違えば error", async () => {
    expect((await changeReveal(1, { fetchImpl: fetchReturning(reply(200, { ok: true })) })).kind).toBe("error");
  });

  it("resetEverythingRequest:確認の合言葉を本文に入れて送り、削除した件数を読む", async () => {
    const fetchImpl = fetchReturning(reply(200, { ok: true, deletedVotes: 17 }));
    expect(await resetEverythingRequest("リセット", { fetchImpl })).toEqual({ kind: "ok", data: { deletedVotes: 17 } });
    expect(JSON.parse(callsOf(fetchImpl)[0][1].body as string)).toEqual({ confirm: "リセット" });
    expect(callsOf(fetchImpl)[0][0]).toBe("/api/admin/reset");
  });

  it("resetEverythingRequest:400(合言葉が違う)は rejected", async () => {
    const result = await resetEverythingRequest("x", { fetchImpl: fetchReturning(reply(400, { ok: false, error: "合言葉が必要です" })) });
    expect(result).toEqual({ kind: "rejected", status: 400, message: "合言葉が必要です" });
  });

  it("logoutRequest:ok を読む", async () => {
    expect(await logoutRequest({ fetchImpl: fetchReturning(reply(200, { ok: true })) })).toEqual({ kind: "ok", data: true });
  });
});

describe("loginRequest", () => {
  it("200 は ok。パスワードは本文だけに入り、URL・ヘッダーには入らない", async () => {
    const fetchImpl = fetchReturning(reply(200, { ok: true }));
    expect(await loginRequest("my-secret-password", { fetchImpl })).toEqual({ kind: "ok" });
    const [url, init] = callsOf(fetchImpl)[0];
    expect(url).toBe("/api/admin/login");
    expect(url).not.toContain("my-secret-password");
    expect(JSON.stringify(init.headers)).not.toContain("my-secret-password");
    expect(JSON.parse(init.body as string)).toEqual({ password: "my-secret-password" });
  });

  it("401 は wrong(パスワードが違う)", async () => {
    const result = await loginRequest("x", { fetchImpl: fetchReturning(reply(401, { ok: false, error: "パスワードが違います。" })) });
    expect(result).toEqual({ kind: "wrong", message: "パスワードが違います。" });
  });

  it("429 は locked。Retry-After の秒数を読む(無ければ60秒)", async () => {
    const withHeader = await loginRequest("x", { fetchImpl: fetchReturning(reply(429, { ok: false, error: "止めています" }, { "Retry-After": "599" })) });
    expect(withHeader).toEqual({ kind: "locked", message: "止めています", retryAfterSec: 599 });
    const without = await loginRequest("x", { fetchImpl: fetchReturning(reply(429, { ok: false, error: "止めています" })) });
    expect(without).toMatchObject({ kind: "locked", retryAfterSec: 60 });
  });

  it("403・503 は rejected、通信エラーは error", async () => {
    expect((await loginRequest("x", { fetchImpl: fetchReturning(reply(503, { ok: false, error: "設定を確認" })) })).kind).toBe("rejected");
    expect((await loginRequest("x", { fetchImpl: fetchReturning(reply(403, { ok: false, error: "Origin" })) })).kind).toBe("rejected");
    expect(await loginRequest("x", { fetchImpl: fetchReturning(() => Promise.reject(new TypeError("offline"))) })).toEqual({
      kind: "error",
      message: NETWORK_ERROR_MESSAGE,
    });
  });
});
