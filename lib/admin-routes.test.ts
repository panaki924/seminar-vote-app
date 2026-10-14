import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 実際の経路のファイル(app/api/admin/*/route.ts)を、そのまま呼ぶ。
// DB の窓口を作ろうとしたら、すぐ失敗するようにしておく(= 認証の前に DB へ触れていないことの証拠)。
const createRepo = vi.fn(() => {
  throw new Error("DB の窓口を作ろうとした(認証の前に DB に触れてはいけない)");
});
vi.mock("./admin-repo", () => ({ createSupabaseAdminRepo: createRepo }));

// テスト専用のダミーのパスワード(本物ではない)
const DUMMY_PASSWORD = "dummy-admin-pass-for-route-tests";

const { POST: login } = await import("../app/api/admin/login/route");
const { POST: logout } = await import("../app/api/admin/logout/route");
const { GET: status } = await import("../app/api/admin/status/route");
const { POST: videos } = await import("../app/api/admin/videos/route");
const { POST: reveal } = await import("../app/api/admin/reveal/route");
const { POST: reset } = await import("../app/api/admin/reset/route");

const BASE = "http://localhost:3000/api/admin";
const postRequest = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${BASE}/${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

// 管理 API の全6本(login は、パスワードを送らなければ 401)
const routes: { name: string; call: (headers?: Record<string, string>) => Promise<Response> }[] = [
  { name: "POST /api/admin/login(パスワードなし)", call: (h) => login(postRequest("login", {}, h)) },
  { name: "POST /api/admin/logout", call: (h) => logout(postRequest("logout", {}, h)) },
  { name: "GET  /api/admin/status", call: (h) => status(new Request(`${BASE}/status`, { headers: h })) },
  { name: "POST /api/admin/videos", call: (h) => videos(postRequest("videos", { memberId: "K0002", action: "start" }, h)) },
  { name: "POST /api/admin/reveal", call: (h) => reveal(postRequest("reveal", { stage: 1 }, h)) },
  { name: "POST /api/admin/reset", call: (h) => reset(postRequest("reset", { confirm: "リセット" }, h)) },
];

describe("管理 API の全6本:ログインなしでは、すべて 401", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_PASSWORD", DUMMY_PASSWORD);
    createRepo.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("経路が6本ある(増やしたときは、このテストにも足す)", () => {
    expect(routes).toHaveLength(6);
  });

  for (const route of routes) {
    it(`${route.name}:Cookie なしで 401`, async () => {
      const res = await route.call();
      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")).toContain("no-store");
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(String(((await res.json()) as { error: string }).error).length).toBeGreaterThan(0);
    });

    it(`${route.name}:壊れた Cookie でも 401`, async () => {
      const res = await route.call({ cookie: "admin_session=forged.token.value" });
      expect(res.status).toBe(401);
    });
  }

  it("login 以外の5本は、401 のとき DB の窓口を作ってもいない(認証より前に DB に触れない)", async () => {
    for (const route of routes.slice(1)) await route.call();
    expect(createRepo).not.toHaveBeenCalled();
  });

  it("login は、間違ったパスワードでも 401(DB に触れない)", async () => {
    const res = await login(postRequest("login", { password: "wrong-password-xyz" }, { "x-forwarded-for": "198.51.100.1" }));
    expect(res.status).toBe(401);
    expect(createRepo).not.toHaveBeenCalled();
  }, 15_000);
});

describe("ADMIN_PASSWORD が設定されていないとき", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_PASSWORD", "");
    createRepo.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("管理 API の全6本が、安全側に倒れて 503(誰も入れない。DB に触れない)", async () => {
    for (const route of routes) expect((await route.call()).status).toBe(503);
    expect(createRepo).not.toHaveBeenCalled();
  });
});
