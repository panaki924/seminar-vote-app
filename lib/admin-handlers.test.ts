import { describe, expect, it, vi } from "vitest";
import {
  createSessionToken,
  LoginLimiter,
  readCookie,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  verifySessionToken,
} from "./admin-auth";
import {
  guardAdmin,
  handleLogin,
  handleLogout,
  handleQr,
  handleReset,
  handleReveal,
  handleStatus,
  handleVideos,
  type AdminDeps,
} from "./admin-handlers";
import type { AdminRepo } from "./admin-service";
import { lockNotice } from "./admin-view";

// テスト専用のダミーのパスワード(本物ではない)
const PASSWORD = "dummy-admin-pass-for-tests-123";
const NOW = Date.UTC(2026, 9, 22, 1, 0, 0);
const BASE = "http://localhost:3000";

function makeDeps(over: Partial<AdminDeps> = {}) {
  const repo = {
    listVideos: vi.fn(async () => []),
    listMembers: vi.fn(async () => []),
    listVotes: vi.fn(async () => []),
    getRevealStage: vi.fn(async () => 0),
    setVideoStatus: vi.fn(async () => "ok" as const),
    setRevealStage: vi.fn(async () => {}),
    resetAll: vi.fn(async () => ({ deletedVotes: 0 })),
  } satisfies AdminRepo;
  const getRepo = vi.fn(() => repo);
  const sleep = vi.fn(async (ms: number) => {
    void ms; // 待ち時間は、実際には待たず、呼ばれた引数だけを記録する
  });
  const deps: AdminDeps = {
    getPassword: () => PASSWORD,
    now: () => NOW,
    sleep,
    limiter: new LoginLimiter(),
    getRepo,
    isProduction: false,
    ...over,
  };
  return { deps, repo, getRepo, sleep };
}

const cookieFor = (password = PASSWORD, now = NOW) => `${SESSION_COOKIE_NAME}=${createSessionToken(password, now)}`;

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const get = (path: string, headers: Record<string, string> = {}) => new Request(`${BASE}${path}`, { headers });

const json = async (res: Response) => (await res.json()) as Record<string, unknown>;

// ---------- ログイン ----------
describe("handleLogin", () => {
  it("正しいパスワードなら 200。セッション Cookie を渡す(HttpOnly・SameSite=Strict・8時間)", async () => {
    const { deps, sleep } = makeDeps();
    const res = await handleLogin(post("/api/admin/login", { password: PASSWORD }), deps);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true });

    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Max-Age=28800");
    expect(setCookie).not.toContain("Secure"); // 開発中(http)
    expect(sleep).not.toHaveBeenCalled(); // 成功のときは、待たせない
  });

  it("渡された Cookie の値は、同じパスワードで確かめると有効。パスワードそのものは含まれない", async () => {
    const { deps } = makeDeps();
    const res = await handleLogin(post("/api/admin/login", { password: PASSWORD }), deps);
    const token = readCookie(res.headers.get("set-cookie"), SESSION_COOKIE_NAME)!;
    expect(verifySessionToken(token, PASSWORD, NOW)).toBe(true);
    expect(verifySessionToken(token, PASSWORD, NOW + SESSION_TTL_MS + 5000)).toBe(false);
    expect(res.headers.get("set-cookie")).not.toContain(PASSWORD);
    expect(JSON.stringify(await json(res))).not.toContain(PASSWORD);
  });

  it("本番(https)では Secure がつく", async () => {
    const { deps } = makeDeps({ isProduction: true });
    const res = await handleLogin(post("/api/admin/login", { password: PASSWORD }), deps);
    expect(res.headers.get("set-cookie")).toContain("Secure");
  });

  it("間違ったパスワードは 401(Cookie は渡さない)。失敗のたびに待ち時間が倍になる(1秒→2秒→4秒)", async () => {
    const { deps, sleep } = makeDeps();
    for (let i = 0; i < 3; i++) {
      const res = await handleLogin(post("/api/admin/login", { password: "wrong-password-xyz" }), deps);
      expect(res.status).toBe(401);
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(String((await json(res)).error)).toContain("パスワードが違います");
    }
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 4000]);
  });

  it.each([
    ["本文が無い", undefined],
    ["パスワードが無い", {}],
    ["空のパスワード", { password: "" }],
    ["文字列でないパスワード", { password: 12345 }],
    ["null", { password: null }],
    ["長すぎるパスワード", { password: "a".repeat(5000) }],
  ])("ログインできない入力(%s)は 401(失敗として数える)", async (_label, body) => {
    const { deps, sleep } = makeDeps();
    const res = await handleLogin(post("/api/admin/login", body), deps);
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("本文が JSON でなくても、例外にならず 401", async () => {
    const { deps } = makeDeps();
    const res = await handleLogin(
      new Request(`${BASE}/api/admin/login`, { method: "POST", headers: { host: "localhost:3000" }, body: "{ not json" }),
      deps,
    );
    expect(res.status).toBe(401);
  });

  it("同じ IP から5回失敗すると、6回目は(正しいパスワードでも)429。Retry-After つき", async () => {
    const { deps } = makeDeps();
    const ipHeader = { "x-forwarded-for": "203.0.113.5" };
    for (let i = 0; i < 5; i++) await handleLogin(post("/api/admin/login", { password: "wrong-password-xyz" }, ipHeader), deps);

    const blocked = await handleLogin(post("/api/admin/login", { password: PASSWORD }, ipHeader), deps);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(blocked.headers.get("set-cookie")).toBeNull();
    expect(String((await json(blocked)).error)).toContain("分後");

    // 別の IP は受け付ける
    const other = await handleLogin(post("/api/admin/login", { password: PASSWORD }, { "x-forwarded-for": "198.51.100.9" }), deps);
    expect(other.status).toBe(200);
  });

  it("x-forwarded-for を毎回変えて偽装しても、全体で30回失敗すると、全員(正しいパスワードの人も)429", async () => {
    const { deps } = makeDeps();
    for (let i = 0; i < 30; i++) {
      await handleLogin(post("/api/admin/login", { password: "wrong-password-xyz" }, { "x-forwarded-for": `10.0.0.${i}` }), deps);
    }
    const res = await handleLogin(post("/api/admin/login", { password: PASSWORD }, { "x-forwarded-for": "192.0.2.77" }), deps);
    expect(res.status).toBe(429);
    expect(String((await json(res)).error)).toContain("一時的に止めて");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("本物のサーバーの停止メッセージ(IP ごと・全体)から、画面の案内文を作ると、残り時間が1か所だけになる", async () => {
    const timeMentions = (text: string) => (text.match(/(約\s*\d+\s*分|\d+\s*秒)/g) ?? []).length;

    // IP ごとの停止
    const ipDeps = makeDeps().deps;
    const ip = { "x-forwarded-for": "203.0.113.5" };
    for (let i = 0; i < 5; i++) await handleLogin(post("/api/admin/login", { password: "wrong-password-xyz" }, ip), ipDeps);
    const ipBlocked = await handleLogin(post("/api/admin/login", { password: PASSWORD }, ip), ipDeps);
    const ipMessage = String((await json(ipBlocked)).error);
    expect(timeMentions(ipMessage)).toBe(1); // サーバーの文には、時間が1つ入っている(約 N 分後に)
    const ipNotice = lockNotice(ipMessage, Number(ipBlocked.headers.get("retry-after")));
    expect(timeMentions(ipNotice)).toBe(1); // 画面の案内文でも、1つだけ(残り時間)
    expect(ipNotice).toContain("ほど、お待ちください。");

    // 全体の停止
    const globalDeps = makeDeps().deps;
    for (let i = 0; i < 30; i++) {
      await handleLogin(post("/api/admin/login", { password: "wrong-password-xyz" }, { "x-forwarded-for": `10.0.0.${i}` }), globalDeps);
    }
    const globalBlocked = await handleLogin(post("/api/admin/login", { password: PASSWORD }, { "x-forwarded-for": "192.0.2.77" }), globalDeps);
    const globalNotice = lockNotice(String((await json(globalBlocked)).error), Number(globalBlocked.headers.get("retry-after")));
    expect(timeMentions(globalNotice)).toBe(1);
    expect(globalNotice).toContain("一時的に止めています");
  });

  it("止めている間は、パスワードの照合もしない(待ち時間も増やさない)", async () => {
    const { deps, sleep } = makeDeps();
    const ip = { "x-forwarded-for": "203.0.113.5" };
    for (let i = 0; i < 5; i++) await handleLogin(post("/api/admin/login", { password: "wrong-password-xyz" }, ip), deps);
    sleep.mockClear();
    await handleLogin(post("/api/admin/login", { password: "wrong-password-xyz" }, ip), deps);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("成功すると、その IP の失敗の記録が消える", async () => {
    const { deps, sleep } = makeDeps();
    const ip = { "x-forwarded-for": "203.0.113.5" };
    for (let i = 0; i < 3; i++) await handleLogin(post("/api/admin/login", { password: "wrong-password-xyz" }, ip), deps);
    await handleLogin(post("/api/admin/login", { password: PASSWORD }, ip), deps);
    sleep.mockClear();
    await handleLogin(post("/api/admin/login", { password: "wrong-password-xyz" }, ip), deps);
    expect(sleep.mock.calls[0][0]).toBe(1000); // 1回目として数え直し
  });

  it("ADMIN_PASSWORD が未設定・短すぎるときは、503(ログインできない。DB にも触れない)", async () => {
    for (const password of [undefined, "", "short-11-ch"]) {
      const { deps, getRepo } = makeDeps({ getPassword: () => password });
      const res = await handleLogin(post("/api/admin/login", { password: password ?? "x" }), deps);
      expect(res.status).toBe(503);
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(String((await json(res)).error)).toContain("ADMIN_PASSWORD");
      expect(getRepo).not.toHaveBeenCalled();
    }
  });

  it("別のサイトからの Origin は 403", async () => {
    const { deps } = makeDeps();
    const res = await handleLogin(post("/api/admin/login", { password: PASSWORD }, { origin: "https://evil.example" }), deps);
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("どの返事も、キャッシュさせない", async () => {
    const { deps } = makeDeps();
    for (const body of [{ password: PASSWORD }, { password: "wrong-password-xyz" }]) {
      const res = await handleLogin(post("/api/admin/login", body), deps);
      expect(res.headers.get("cache-control")).toContain("no-store");
    }
  });
});

// ---------- 入口の確認(guardAdmin) ----------
describe("guardAdmin", () => {
  it("有効なセッションがあれば、通る(null)", () => {
    const { deps } = makeDeps();
    expect(guardAdmin(get("/x", { cookie: cookieFor() }), deps, { checkOrigin: false })).toBeNull();
  });

  it("Cookie が無い・壊れている・期限切れ・別のパスワードで作られたものは、401", async () => {
    const { deps } = makeDeps();
    const cases = [
      undefined,
      `${SESSION_COOKIE_NAME}=garbage`,
      cookieFor(PASSWORD, NOW - SESSION_TTL_MS - 60_000), // 期限切れ
      cookieFor("another-password-123456"), // 別のパスワードで署名
    ];
    for (const cookie of cases) {
      const denied = guardAdmin(get("/x", cookie ? { cookie } : {}), deps, { checkOrigin: false });
      expect(denied?.status).toBe(401);
      expect(String((await json(denied!)).error)).toContain("ログイン");
    }
  });

  it("書き換えられた Cookie(署名が合わない)は 401", () => {
    const { deps } = makeDeps();
    const [exp, nonce, sig] = createSessionToken(PASSWORD, NOW).split(".");
    const tampered = `${SESSION_COOKIE_NAME}=${Number(exp) + 7200}.${nonce}.${sig}`;
    expect(guardAdmin(get("/x", { cookie: tampered }), deps, { checkOrigin: false })?.status).toBe(401);
  });

  it("設定が足りない(パスワード未設定・短い)ときは、安全側に倒して 503", () => {
    for (const password of [undefined, "short"]) {
      const { deps } = makeDeps({ getPassword: () => password });
      expect(guardAdmin(get("/x", { cookie: cookieFor() }), deps, { checkOrigin: false })?.status).toBe(503);
    }
  });

  it("POST:別のサイトの Origin は、有効な Cookie があっても 403", () => {
    const { deps } = makeDeps();
    const request = post("/x", {}, { cookie: cookieFor(), origin: "https://evil.example" });
    expect(guardAdmin(request, deps, { checkOrigin: true })?.status).toBe(403);
  });

  it("POST:同じサイトの Origin、Origin なし、中継サーバー経由(X-Forwarded-Host)は通る", () => {
    const { deps } = makeDeps();
    const cookie = cookieFor();
    expect(guardAdmin(post("/x", {}, { cookie, origin: "http://localhost:3000" }), deps, { checkOrigin: true })).toBeNull();
    expect(guardAdmin(post("/x", {}, { cookie }), deps, { checkOrigin: true })).toBeNull();
    const proxied = post("/x", {}, { cookie, origin: "http://localhost:4111", host: "localhost:3111", "x-forwarded-host": "localhost:4111" });
    expect(guardAdmin(proxied, deps, { checkOrigin: true })).toBeNull();
  });
});

// ---------- 管理 API:ログインなしでは、DB に一切触れない ----------
describe("ログインなしの管理 API(login 以外の5本)", () => {
  const cases: [string, (req: Request, deps: AdminDeps) => Promise<Response>, Request][] = [
    ["logout", handleLogout, post("/api/admin/logout", {})],
    ["status", handleStatus, get("/api/admin/status")],
    ["videos", handleVideos, post("/api/admin/videos", { memberId: "K0002", action: "start" })],
    ["reveal", handleReveal, post("/api/admin/reveal", { stage: 1 })],
    ["reset", handleReset, post("/api/admin/reset", { confirm: "リセット" })],
  ];

  for (const [name, handler, request] of cases) {
    it(`${name}:Cookie が無ければ 401 で、DB の窓口を作りもしない`, async () => {
      const { deps, getRepo } = makeDeps();
      const res = await handler(request.clone(), deps);
      expect(res.status).toBe(401);
      expect(getRepo).not.toHaveBeenCalled();
      expect(res.headers.get("cache-control")).toContain("no-store");
    });

    it(`${name}:壊れた Cookie でも 401 で、DB に触れない`, async () => {
      const { deps, getRepo } = makeDeps();
      const withBadCookie = new Request(request.clone(), { headers: { ...Object.fromEntries(request.headers), cookie: `${SESSION_COOKIE_NAME}=bad.token.value` } });
      expect((await handler(withBadCookie, deps)).status).toBe(401);
      expect(getRepo).not.toHaveBeenCalled();
    });
  }

  it("ログインしていても、別のサイトの Origin の POST(logout・videos・reveal・reset)は 403 で、DB に触れない", async () => {
    for (const [, handler, request] of cases.filter(([name]) => name !== "status")) {
      const { deps, getRepo } = makeDeps();
      const evil = new Request(request.clone(), {
        headers: { ...Object.fromEntries(request.headers), cookie: cookieFor(), origin: "https://evil.example" },
      });
      expect((await handler(evil, deps)).status).toBe(403);
      expect(getRepo).not.toHaveBeenCalled();
    }
  });
});

// ---------- ログイン済みの操作 ----------
describe("ログイン済みの管理 API", () => {
  const authed = (path: string, body?: unknown) =>
    body === undefined
      ? get(path, { cookie: cookieFor() })
      : post(path, body, { cookie: cookieFor() });

  it("status:200 で、状態を返す。DB の窓口を使う", async () => {
    const { deps, repo } = makeDeps();
    const res = await handleStatus(authed("/api/admin/status"), deps);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, revealStage: 0 });
    expect(repo.listVideos).toHaveBeenCalled();
  });

  it("videos:動画の状態を切り替える", async () => {
    const { deps, repo } = makeDeps();
    repo.listVideos.mockResolvedValue([{ memberId: "K0002", name: "豊臣秀吉", nameEn: "Toyotomi Hideyoshi", status: "pending" }] as never);
    const res = await handleVideos(authed("/api/admin/videos", { memberId: "K0002", action: "start" }), deps);
    expect(res.status).toBe(200);
    expect(repo.setVideoStatus).toHaveBeenCalledWith("K0002", "pending", "open");
  });

  it("reveal:発表段階を変える。範囲外は 400", async () => {
    const { deps, repo } = makeDeps();
    expect((await handleReveal(authed("/api/admin/reveal", { stage: 2 }), deps)).status).toBe(200);
    expect(repo.setRevealStage).toHaveBeenCalledWith(2);
    expect((await handleReveal(authed("/api/admin/reveal", { stage: 9 }), deps)).status).toBe(400);
  });

  it("reset:確認の合言葉が無ければ、ログイン済みでも 400 で、何も消さない", async () => {
    const { deps, repo } = makeDeps();
    const res = await handleReset(authed("/api/admin/reset", {}), deps);
    expect(res.status).toBe(400);
    expect(String((await json(res)).error)).toContain("リセット");
    expect(repo.resetAll).not.toHaveBeenCalled();
  });

  it("reset:合言葉があれば実行する", async () => {
    const { deps, repo } = makeDeps();
    repo.resetAll.mockResolvedValue({ deletedVotes: 7 });
    const res = await handleReset(authed("/api/admin/reset", { confirm: "リセット" }), deps);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, deletedVotes: 7 });
  });

  it("本文が JSON でなければ 400(videos・reveal・reset)", async () => {
    const { deps } = makeDeps();
    for (const [path, handler] of [
      ["/api/admin/videos", handleVideos],
      ["/api/admin/reveal", handleReveal],
      ["/api/admin/reset", handleReset],
    ] as const) {
      const bad = new Request(`${BASE}${path}`, { method: "POST", headers: { host: "localhost:3000", cookie: cookieFor() }, body: "{ not json" });
      expect((await handler(bad, deps)).status).toBe(400);
    }
  });

  it("logout:Cookie を消す(Max-Age=0)", async () => {
    const { deps } = makeDeps();
    const res = await handleLogout(authed("/api/admin/logout", {}), deps);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(setCookie).toContain("Max-Age=0");
  });

  it("Next.js の内部の合図(事前生成の中断)は、500 に変えず、そのまま投げ直す", async () => {
    const interrupted = Object.assign(
      new Error("Route /api/admin/status needs to bail out of prerendering at this point because it used request.headers."),
      { digest: "NEXT_PRERENDER_INTERRUPTED" },
    );
    const { deps } = makeDeps({ getRepo: () => { throw interrupted; } });
    await expect(handleStatus(authed("/api/admin/status"), deps)).rejects.toBe(interrupted);
    await expect(handleVideos(authed("/api/admin/videos", { memberId: "K0002", action: "start" }), deps)).rejects.toBe(interrupted);
  });

  it("DB の窓口が壊れていても、返事に内容を出さず 500(status・videos・reveal・reset)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = vi.fn(() => {
      throw new Error("SECRET-DB-DETAIL postgres://user:pass@host");
    });
    for (const [handler, request] of [
      [handleStatus, authed("/api/admin/status")],
      [handleVideos, authed("/api/admin/videos", { memberId: "K0002", action: "start" })],
      [handleReveal, authed("/api/admin/reveal", { stage: 1 })],
      [handleReset, authed("/api/admin/reset", { confirm: "リセット" })],
    ] as const) {
      const { deps } = makeDeps({ getRepo: failing });
      const res = await handler(request, deps);
      expect(res.status).toBe(500);
      const text = JSON.stringify(await json(res));
      expect(text).not.toContain("SECRET-DB-DETAIL");
      expect(text).not.toContain("postgres://");
    }
  });
});

// ---------- QR 用の名簿(トークンを含む) ----------
describe("handleQr(QR 用の名簿)", () => {
  const members = [
    { id: "S001", name: "豊臣秀長", nameEn: "Toyotomi Hidenaga", token: "t".repeat(64) },
    { id: "K0002", name: "豊臣秀吉", nameEn: "Toyotomi Hideyoshi", token: "u".repeat(64) },
    { id: "K0001", name: "織田信長", nameEn: "Oda Nobunaga", token: "v".repeat(64) },
  ];

  it("ログインしていなければ 401。名簿を取りにも行かない(トークンは返さない)", async () => {
    const { deps } = makeDeps();
    const list = vi.fn(async () => members);
    const res = await handleQr(get("/api/admin/qr"), deps, list);
    expect(res.status).toBe(401);
    expect(list).not.toHaveBeenCalled();
    expect(JSON.stringify(await json(res))).not.toContain("tttt");
  });

  it("ログイン済みなら、名簿順(S001 は最後)で返す。キャッシュさせない", async () => {
    const { deps } = makeDeps();
    const res = await handleQr(get("/api/admin/qr", { cookie: cookieFor() }), deps, async () => members);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = (await json(res)) as { members: { id: string }[] };
    expect(body.members.map((m) => m.id)).toEqual(["K0001", "K0002", "S001"]);
  });

  it("名簿の取得に失敗しても、内容を出さず 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps } = makeDeps();
    const res = await handleQr(get("/api/admin/qr", { cookie: cookieFor() }), deps, async () => { throw new Error("SECRET-DB-DETAIL"); });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await json(res))).not.toContain("SECRET-DB-DETAIL");
  });
});
