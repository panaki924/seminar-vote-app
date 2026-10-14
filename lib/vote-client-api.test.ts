import { describe, expect, it, vi } from "vitest";
import { fetchVoteState, NETWORK_ERROR_MESSAGE, parseSnapshot, submitVoteRequest } from "./vote-client-api";

const TOKEN = "t".repeat(64);

const okState = {
  ok: true,
  voter: { id: "K0001", name: "織田信長" },
  current: { videoId: "K0002", name: "豊臣秀吉", nameEn: "Toyotomi Hideyoshi", isOwn: false },
  myVote: null,
};

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const fetchReturning = (response: Response | (() => Promise<Response>)) =>
  vi.fn(async () => (typeof response === "function" ? response() : response)) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe("parseSnapshot(返事の形を確かめる)", () => {
  it("正しい形なら、画面に渡す状態に変える", () => {
    expect(parseSnapshot(okState)).toEqual({
      voter: okState.voter,
      current: okState.current,
      myVote: null,
    });
  });

  it("投票中の動画なし(current=null)も正しい形", () => {
    expect(parseSnapshot({ ...okState, current: null })?.current).toBeNull();
  });

  it("送信済みの内容(myVote)も読み取る", () => {
    const vote = { tech: 3, impact: 4, updatedAt: "2026-10-22T01:00:00.000Z" };
    expect(parseSnapshot({ ...okState, myVote: vote })?.myVote).toEqual(vote);
  });

  it.each([
    ["オブジェクトでない", "text"],
    ["null", null],
    ["ok が true でない", { ...okState, ok: false }],
    ["voter が無い", { ...okState, voter: undefined }],
    ["voter.name が文字列でない", { ...okState, voter: { id: "K0001", name: 1 } }],
    ["current の項目が足りない", { ...okState, current: { videoId: "K0002" } }],
    ["isOwn が真偽値でない", { ...okState, current: { ...okState.current, isOwn: "no" } }],
    ["myVote の点数が数値でない", { ...okState, myVote: { tech: "3", impact: 4, updatedAt: "x" } }],
    ["current が undefined", { ...okState, current: undefined }],
  ])("形が違う(%s)なら null", (_label, json) => {
    expect(parseSnapshot(json)).toBeNull();
  });
});

describe("fetchVoteState", () => {
  it("200 で正しい返事なら ok。トークンはヘッダーで送り、URL には含めない。キャッシュしない", async () => {
    const fetchImpl = fetchReturning(reply(200, okState));
    const result = await fetchVoteState(TOKEN, { fetchImpl });
    expect(result.kind).toBe("ok");
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe("/api/vote");
    expect(url).not.toContain(TOKEN);
    expect((init.headers as Record<string, string>)["x-vote-token"]).toBe(TOKEN);
    expect(init.cache).toBe("no-store");
    expect(init.method).toBe("GET");
  });

  it("401 は unauthorized(APIのメッセージをそのまま使う)", async () => {
    const result = await fetchVoteState(TOKEN, {
      fetchImpl: fetchReturning(reply(401, { ok: false, error: "本人確認できませんでした。" })),
    });
    expect(result).toEqual({ kind: "unauthorized", message: "本人確認できませんでした。" });
  });

  it("500 は、あとで再試行できる error(APIのメッセージを使う)", async () => {
    const result = await fetchVoteState(TOKEN, {
      fetchImpl: fetchReturning(reply(500, { ok: false, error: "サーバーでエラーが起きました。" })),
    });
    expect(result).toEqual({ kind: "error", message: "サーバーでエラーが起きました。" });
  });

  it("通信そのものに失敗したら error(通信エラーの文)", async () => {
    const fetchImpl = fetchReturning(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await fetchVoteState(TOKEN, { fetchImpl })).toEqual({ kind: "error", message: NETWORK_ERROR_MESSAGE });
  });

  it("200 でも返事の形が違えば error", async () => {
    const result = await fetchVoteState(TOKEN, { fetchImpl: fetchReturning(reply(200, { ok: true })) });
    expect(result.kind).toBe("error");
  });

  it("JSON でない返事(HTML など)でも、例外にせず error にする", async () => {
    const result = await fetchVoteState(TOKEN, {
      fetchImpl: fetchReturning(new Response("<html>bad gateway</html>", { status: 502 })),
    });
    expect(result.kind).toBe("error");
  });

  it("中断(abort)されたときは、通信エラーにせず例外のまま伝える", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = fetchReturning(() => Promise.reject(new DOMException("aborted", "AbortError")));
    await expect(fetchVoteState(TOKEN, { fetchImpl, signal: controller.signal })).rejects.toThrow();
  });
});

describe("submitVoteRequest", () => {
  const vote = { targetId: "K0002", tech: 3, impact: 4 };
  const saved = { tech: 3, impact: 4, updatedAt: "2026-10-22T01:00:00.000Z" };

  it("成功すると保存された内容を返す。本文は JSON、トークンはヘッダー", async () => {
    const fetchImpl = fetchReturning(reply(200, { ok: true, myVote: saved }));
    const result = await submitVoteRequest(TOKEN, vote, { fetchImpl });
    expect(result).toEqual({ kind: "ok", vote: saved });
    const [, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(vote);
    expect((init.headers as Record<string, string>)["x-vote-token"]).toBe(TOKEN);
    expect(init.body as string).not.toContain(TOKEN); // 本文にトークンは入れない
  });

  it.each([400, 403, 409])("%i は rejected(メッセージつき)", async (status) => {
    const result = await submitVoteRequest(TOKEN, vote, {
      fetchImpl: fetchReturning(reply(status, { ok: false, error: "理由の文" })),
    });
    expect(result).toEqual({ kind: "rejected", status, message: "理由の文" });
  });

  it("401 は unauthorized", async () => {
    const result = await submitVoteRequest(TOKEN, vote, {
      fetchImpl: fetchReturning(reply(401, { ok: false, error: "本人確認できません" })),
    });
    expect(result).toEqual({ kind: "unauthorized", message: "本人確認できません" });
  });

  it("500 と通信エラーは error(下書きを残して、もう一度送れるようにする)", async () => {
    expect(
      (await submitVoteRequest(TOKEN, vote, { fetchImpl: fetchReturning(reply(500, { ok: false, error: "x" })) })).kind,
    ).toBe("error");
    expect(
      await submitVoteRequest(TOKEN, vote, { fetchImpl: fetchReturning(() => Promise.reject(new TypeError("offline"))) }),
    ).toEqual({ kind: "error", message: NETWORK_ERROR_MESSAGE });
  });

  it("200 でも保存内容が読めなければ error(成功と表示しない)", async () => {
    const result = await submitVoteRequest(TOKEN, vote, {
      fetchImpl: fetchReturning(reply(200, { ok: true, myVote: { tech: "3" } })),
    });
    expect(result.kind).toBe("error");
  });
});
