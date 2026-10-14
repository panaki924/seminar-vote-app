import { describe, expect, it } from "vitest";
import {
  clientIpOf,
  createSessionToken,
  isAdminRequest,
  isAllowedOrigin,
  isPasswordStrongEnough,
  LoginLimiter,
  MIN_PASSWORD_LENGTH,
  passwordsMatch,
  readCookie,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  sessionCookieOptions,
  verifySessionToken,
} from "./admin-auth";

// テスト専用のダミーのパスワード(本物ではない)
const PASSWORD = "dummy-admin-pass-for-tests-123";
const NOW = Date.UTC(2026, 9, 22, 1, 0, 0); // 2026-10-22 10:00(日本時間)
const MIN = 60_000;

describe("パスワード", () => {
  it("12文字以上だけが、使えるパスワード", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(isPasswordStrongEnough("a".repeat(11))).toBe(false);
    expect(isPasswordStrongEnough("a".repeat(12))).toBe(true);
    for (const bad of [undefined, null, 123456789012, ""]) expect(isPasswordStrongEnough(bad)).toBe(false);
  });

  it("同じ文字列だけが一致する", () => {
    expect(passwordsMatch(PASSWORD, PASSWORD)).toBe(true);
    expect(passwordsMatch(PASSWORD + "x", PASSWORD)).toBe(false);
    expect(passwordsMatch(PASSWORD.slice(0, -1), PASSWORD)).toBe(false);
    expect(passwordsMatch(PASSWORD.toUpperCase(), PASSWORD)).toBe(false);
    expect(passwordsMatch(` ${PASSWORD}`, PASSWORD)).toBe(false); // 空白は取り除かない
  });

  it("文字列でない入力・空の入力は、例外にせず false", () => {
    for (const bad of [undefined, null, 0, {}, [], ""]) expect(passwordsMatch(bad, PASSWORD)).toBe(false);
  });

  it("長さがまったく違う入力でも、例外にならず false(比べる前に同じ長さにそろえる)", () => {
    expect(passwordsMatch("a", PASSWORD)).toBe(false);
    expect(passwordsMatch("a".repeat(100_000), PASSWORD)).toBe(false);
  });
});

describe("署名つきセッション Cookie", () => {
  it("作ったものは、同じパスワードで確かめると有効", () => {
    expect(verifySessionToken(createSessionToken(PASSWORD, NOW), PASSWORD, NOW)).toBe(true);
  });

  it("Cookie の値に、パスワードは含まれない", () => {
    expect(createSessionToken(PASSWORD, NOW)).not.toContain(PASSWORD);
  });

  it("毎回違う値になる(乱数が入る)", () => {
    expect(createSessionToken(PASSWORD, NOW)).not.toBe(createSessionToken(PASSWORD, NOW));
  });

  it("別のパスワードで確かめると無効(パスワードを変えると、全セッションが無効になる)", () => {
    expect(verifySessionToken(createSessionToken(PASSWORD, NOW), PASSWORD + "-changed", NOW)).toBe(false);
  });

  it("期限の直前までは有効で、期限になると無効", () => {
    const token = createSessionToken(PASSWORD, NOW);
    expect(verifySessionToken(token, PASSWORD, NOW + SESSION_TTL_MS - 2000)).toBe(true);
    expect(verifySessionToken(token, PASSWORD, NOW + SESSION_TTL_MS + 1000)).toBe(false);
    expect(verifySessionToken(token, PASSWORD, NOW + SESSION_TTL_MS + 24 * 60 * MIN)).toBe(false);
  });

  it("有効期間は8時間", () => {
    expect(SESSION_TTL_MS).toBe(8 * 60 * MIN);
  });

  it("遠い未来の期限(想定の有効期間を超える)は無効", () => {
    const farFuture = createSessionToken(PASSWORD, NOW + 10 * 24 * 60 * MIN); // 10日後に作ったことにする
    expect(verifySessionToken(farFuture, PASSWORD, NOW)).toBe(false);
  });

  it("どの部分を書き換えても無効(期限・乱数・署名)", () => {
    const [exp, nonce, sig] = createSessionToken(PASSWORD, NOW).split(".");
    const longerExp = String(Number(exp) + 3600);
    const flipped = (s: string) => (s.startsWith("A") ? "B" : "A") + s.slice(1);
    expect(verifySessionToken([longerExp, nonce, sig].join("."), PASSWORD, NOW)).toBe(false);
    expect(verifySessionToken([exp, flipped(nonce), sig].join("."), PASSWORD, NOW)).toBe(false);
    expect(verifySessionToken([exp, nonce, flipped(sig)].join("."), PASSWORD, NOW)).toBe(false);
  });

  it.each([
    ["空", ""],
    ["null", null],
    ["undefined", undefined],
    ["区切りが足りない", "123.abc"],
    ["区切りが多い", "1.2.3.4"],
    ["署名が空", "9999999999.aaaaaaaaaaaaaaaaaaaaaa."],
    ["数字でない期限", "abc.aaaaaaaaaaaaaaaaaaaaaa.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
    ["長すぎる", "x".repeat(500)],
    ["記号入り", "9999999999.aaaaaaaaaaaaaaaa'--.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
  ])("形式が違う(%s)ものは無効", (_label, token) => {
    expect(verifySessionToken(token as string | null | undefined, PASSWORD, NOW)).toBe(false);
  });
});

describe("Cookie ヘッダーの読み取り", () => {
  it("名前を指定して値を取り出す(ほかの Cookie があっても、空白があっても)", () => {
    expect(readCookie("a=1; admin_session=tok.en.sig; b=2", "admin_session")).toBe("tok.en.sig");
    expect(readCookie("admin_session=only", "admin_session")).toBe("only");
    expect(readCookie("  a=1 ;  admin_session = spaced ", "admin_session")).toBe("spaced");
  });

  it("名前が前方一致するだけの別の Cookie は、読まない", () => {
    expect(readCookie("xadmin_session=bad; admin_session_old=bad2", "admin_session")).toBeNull();
  });

  it("無い・空・形式が違うときは null", () => {
    expect(readCookie(null, "admin_session")).toBeNull();
    expect(readCookie("", "admin_session")).toBeNull();
    expect(readCookie("novalue", "admin_session")).toBeNull();
  });

  it("%エンコードされた値は戻して読む。壊れたエンコードでも例外にしない", () => {
    expect(readCookie("admin_session=a%2Eb", "admin_session")).toBe("a.b");
    expect(readCookie("admin_session=%E0%A4%A", "admin_session")).toBe("%E0%A4%A");
  });
});

describe("isAdminRequest", () => {
  const requestWith = (cookie?: string) => new Request("http://localhost/api/admin/status", { headers: cookie ? { cookie } : {} });

  it("有効なセッションの Cookie があれば true", () => {
    const token = createSessionToken(PASSWORD, NOW);
    expect(isAdminRequest(requestWith(`${SESSION_COOKIE_NAME}=${token}`), PASSWORD, NOW)).toBe(true);
  });

  it("Cookie が無い・壊れている・期限切れなら false", () => {
    const token = createSessionToken(PASSWORD, NOW);
    expect(isAdminRequest(requestWith(), PASSWORD, NOW)).toBe(false);
    expect(isAdminRequest(requestWith(`${SESSION_COOKIE_NAME}=garbage`), PASSWORD, NOW)).toBe(false);
    expect(isAdminRequest(requestWith(`${SESSION_COOKIE_NAME}=${token}`), PASSWORD, NOW + SESSION_TTL_MS + 5000)).toBe(false);
  });
});

describe("Cookie の設定", () => {
  it("HttpOnly・SameSite=Strict・パス / ・8時間。本番だけ Secure", () => {
    expect(sessionCookieOptions(true)).toEqual({ httpOnly: true, sameSite: "strict", secure: true, path: "/", maxAge: 28800 });
    expect(sessionCookieOptions(false)).toMatchObject({ httpOnly: true, sameSite: "strict", secure: false });
  });
});

describe("isAllowedOrigin(POST の Origin の確認)", () => {
  const h = (init: Record<string, string>) => new Headers(init);

  it("本番(https):Origin と Host が同じなら許す", () => {
    expect(isAllowedOrigin(h({ origin: "https://seminar-vote.vercel.app", host: "seminar-vote.vercel.app" }))).toBe(true);
  });

  it("localhost:ポートまで同じなら許す", () => {
    expect(isAllowedOrigin(h({ origin: "http://localhost:3000", host: "localhost:3000" }))).toBe(true);
    expect(isAllowedOrigin(h({ origin: "http://127.0.0.1:3111", host: "127.0.0.1:3111" }))).toBe(true);
  });

  it("標準のポート(443)が Origin に書かれていても、Host に無くて許す", () => {
    expect(isAllowedOrigin(h({ origin: "https://example.com:443", host: "example.com" }))).toBe(true);
    expect(isAllowedOrigin(h({ origin: "http://example.com:80", host: "example.com" }))).toBe(true);
  });

  it("大文字小文字は区別しない", () => {
    expect(isAllowedOrigin(h({ origin: "https://Example.COM", host: "example.com" }))).toBe(true);
  });

  it("中継サーバー:Host を書き換えられても、X-Forwarded-Host が Origin と同じなら許す(5d の中継サーバーのような場合)", () => {
    expect(isAllowedOrigin(h({ origin: "http://localhost:4111", host: "localhost:3111", "x-forwarded-host": "localhost:4111" }))).toBe(true);
    expect(isAllowedOrigin(h({ origin: "https://seminar-vote.vercel.app", host: "internal-lambda:3000", "x-forwarded-host": "seminar-vote.vercel.app" }))).toBe(true);
  });

  it("X-Forwarded-Host が複数あるときは、先頭を見る", () => {
    expect(isAllowedOrigin(h({ origin: "http://localhost:4111", host: "localhost:3111", "x-forwarded-host": "localhost:4111, proxy2:9" }))).toBe(true);
  });

  it("中継サーバーが Origin を取り除いた(Origin なし)場合は、許す", () => {
    expect(isAllowedOrigin(h({ host: "localhost:3111" }))).toBe(true);
  });

  it("Origin が無い通信(ブラウザ以外の道具)は許す", () => {
    expect(isAllowedOrigin(h({ host: "example.com" }))).toBe(true);
  });

  it("別のサイトからの通信は断る", () => {
    expect(isAllowedOrigin(h({ origin: "https://evil.example", host: "seminar-vote.vercel.app" }))).toBe(false);
  });

  it("似た名前(後ろに別のドメインが続く・前に付く)は断る", () => {
    expect(isAllowedOrigin(h({ origin: "https://seminar-vote.vercel.app.evil.com", host: "seminar-vote.vercel.app" }))).toBe(false);
    expect(isAllowedOrigin(h({ origin: "https://evil-seminar-vote.vercel.app", host: "seminar-vote.vercel.app" }))).toBe(false);
  });

  it("サブドメインは別のサイトとして断る", () => {
    expect(isAllowedOrigin(h({ origin: "https://attacker.seminar-vote.vercel.app", host: "seminar-vote.vercel.app" }))).toBe(false);
  });

  it("ポートが違うものは断る(localhost の別のアプリからの通信)", () => {
    expect(isAllowedOrigin(h({ origin: "http://localhost:4000", host: "localhost:3000" }))).toBe(false);
    expect(isAllowedOrigin(h({ origin: "http://localhost", host: "localhost:3000" }))).toBe(false);
  });

  it("Origin が 'null' や、読み取れない値は断る", () => {
    expect(isAllowedOrigin(h({ origin: "null", host: "localhost:3000" }))).toBe(false);
    expect(isAllowedOrigin(h({ origin: "not a url", host: "localhost:3000" }))).toBe(false);
    expect(isAllowedOrigin(h({ origin: "", host: "localhost:3000" }))).toBe(false);
  });

  it("Host も X-Forwarded-Host も無いのに Origin があるときは断る", () => {
    expect(isAllowedOrigin(h({ origin: "https://example.com" }))).toBe(false);
  });

  it("Host を書き換えた中継サーバーが X-Forwarded-Host を付けず、Origin もそのままの場合は断る(安全側)", () => {
    expect(isAllowedOrigin(h({ origin: "http://localhost:4111", host: "localhost:3111" }))).toBe(false);
  });
});

describe("LoginLimiter(ログイン失敗の待ち時間と制限)", () => {
  const IP = "203.0.113.5";

  it("最初は受け付ける", () => {
    expect(new LoginLimiter().check(IP, NOW)).toEqual({ allowed: true });
  });

  it("失敗するたびに待ち時間が倍になる(1秒→2秒→4秒→8秒)", () => {
    const limiter = new LoginLimiter();
    const delays = [0, 1, 2, 3].map((i) => limiter.recordFailure(IP, NOW + i * 1000).delayMs);
    expect(delays).toEqual([1000, 2000, 4000, 8000]);
  });

  it("待ち時間は8秒で頭打ち", () => {
    const limiter = new LoginLimiter({ ipMaxFailures: 100 });
    const last = Array.from({ length: 10 }, (_, i) => limiter.recordFailure(IP, NOW + i * 1000).delayMs).pop();
    expect(last).toBe(8000);
  });

  it("同じ IP から5回失敗すると、10分間は止まる(残り秒数つき)", () => {
    const limiter = new LoginLimiter();
    for (let i = 0; i < 5; i++) limiter.recordFailure(IP, NOW + i * 1000);
    const blocked = limiter.check(IP, NOW + 5000);
    expect(blocked).toMatchObject({ allowed: false, scope: "ip" });
    // 止めたのは5回目の失敗の時刻(NOW+4秒)。その1秒後に確かめるので、残りは 600 - 1 = 599 秒
    expect((blocked as { retryAfterSec: number }).retryAfterSec).toBe(599);
  });

  it("4回の失敗では、まだ止まらない", () => {
    const limiter = new LoginLimiter();
    for (let i = 0; i < 4; i++) limiter.recordFailure(IP, NOW + i * 1000);
    expect(limiter.check(IP, NOW + 4000)).toEqual({ allowed: true });
  });

  it("止まっている間も、別の IP は受け付ける", () => {
    const limiter = new LoginLimiter();
    for (let i = 0; i < 5; i++) limiter.recordFailure(IP, NOW + i * 1000);
    expect(limiter.check("198.51.100.7", NOW + 5000)).toEqual({ allowed: true });
  });

  it("10分たつと、その IP はまた受け付ける。失敗の数も数え直し", () => {
    const limiter = new LoginLimiter();
    for (let i = 0; i < 5; i++) limiter.recordFailure(IP, NOW + i * 1000);
    expect(limiter.check(IP, NOW + 4000 + 10 * MIN + 1000)).toEqual({ allowed: true });
    expect(limiter.recordFailure(IP, NOW + 4000 + 10 * MIN + 1000).delayMs).toBe(1000); // 1回目として数える
  });

  it("15分より前の失敗は、数えない", () => {
    const limiter = new LoginLimiter();
    for (let i = 0; i < 4; i++) limiter.recordFailure(IP, NOW + i * 1000);
    limiter.recordFailure(IP, NOW + 16 * MIN); // 前の4回は窓の外なので、これは1回目
    expect(limiter.check(IP, NOW + 16 * MIN)).toEqual({ allowed: true });
  });

  it("成功すると、その IP の失敗の記録が消える", () => {
    const limiter = new LoginLimiter();
    for (let i = 0; i < 4; i++) limiter.recordFailure(IP, NOW + i * 1000);
    limiter.recordSuccess(IP);
    expect(limiter.recordFailure(IP, NOW + 5000).delayMs).toBe(1000);
  });

  it("全体:15分に30回失敗すると、全員を10分止める(別の IP でも、まだ失敗していない IP でも)", () => {
    const limiter = new LoginLimiter();
    for (let i = 0; i < 30; i++) limiter.recordFailure(`10.0.0.${i}`, NOW + i * 1000);
    const blocked = limiter.check("192.0.2.99", NOW + 30_000);
    expect(blocked).toMatchObject({ allowed: false, scope: "global" });
    // 止めたのは30回目の失敗の時刻(NOW+29秒)。その1秒後に確かめるので、残りは 600 - 1 = 599 秒
    expect((blocked as { retryAfterSec: number }).retryAfterSec).toBe(599);
  });

  it("全体:29回では止まらない", () => {
    const limiter = new LoginLimiter();
    for (let i = 0; i < 29; i++) limiter.recordFailure(`10.0.0.${i}`, NOW + i * 1000);
    expect(limiter.check("192.0.2.99", NOW + 30_000)).toEqual({ allowed: true });
  });

  it("x-forwarded-for を毎回変えて偽装しても、全体の上限で止まる(IP ごとの数は1回ずつ)", () => {
    const limiter = new LoginLimiter();
    let blockedAt = -1;
    for (let i = 0; i < 100; i++) {
      const spoofedIp = `198.51.${Math.floor(i / 250)}.${i % 250}`; // 毎回違う IP
      if (!limiter.check(spoofedIp, NOW + i * 100).allowed) { blockedAt = i; break; }
      limiter.recordFailure(spoofedIp, NOW + i * 100);
    }
    expect(blockedAt).toBe(30); // 30回目の失敗のあと、31回目から止まる
  });

  it("全体の停止中は、(正しいパスワードを持つ人を含め)全員が止まる。10分後に解除", () => {
    const limiter = new LoginLimiter();
    for (let i = 0; i < 30; i++) limiter.recordFailure(`10.0.0.${i}`, NOW);
    expect(limiter.check("10.9.9.9", NOW + 9 * MIN).allowed).toBe(false);
    expect(limiter.check("10.9.9.9", NOW + 10 * MIN + 1000)).toEqual({ allowed: true });
  });

  it("成功しても、全体の失敗の数は減らない", () => {
    const limiter = new LoginLimiter();
    for (let i = 0; i < 29; i++) limiter.recordFailure(`10.0.0.${i}`, NOW + i);
    limiter.recordSuccess("10.0.0.1");
    limiter.recordFailure("10.1.1.1", NOW + 100); // 30回目
    expect(limiter.check("10.2.2.2", NOW + 200)).toMatchObject({ allowed: false, scope: "global" });
  });

  it("覚えておく IP の数に上限がある(偽装した IP を大量に送られても、メモリを使い切らない)", () => {
    const limiter = new LoginLimiter({ maxTrackedIps: 5, globalMaxFailures: 100_000 });
    for (let i = 0; i < 200; i++) limiter.recordFailure(`10.0.${Math.floor(i / 250)}.${i % 250}`, NOW + i);
    expect(limiter.trackedIpCount()).toBeLessThanOrEqual(5);
  });

  it("期限の切れた IP の停止記録は、あとで片づく", () => {
    const limiter = new LoginLimiter({ maxTrackedIps: 1000 });
    for (let i = 0; i < 5; i++) limiter.recordFailure(IP, NOW + i);
    expect(limiter.trackedIpCount()).toBe(1);
    limiter.recordFailure("other", NOW + 11 * MIN); // 10分以上あとの別の失敗で、古い停止記録が片づく
    expect(limiter.trackedIpCount()).toBe(1);
  });
});

describe("clientIpOf", () => {
  it("x-forwarded-for の先頭を使う", () => {
    expect(clientIpOf(new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
    expect(clientIpOf(new Headers({ "x-forwarded-for": "  203.0.113.5  " }))).toBe("203.0.113.5");
  });

  it("無い・空・長すぎるときは unknown", () => {
    expect(clientIpOf(new Headers())).toBe("unknown");
    expect(clientIpOf(new Headers({ "x-forwarded-for": "" }))).toBe("unknown");
    expect(clientIpOf(new Headers({ "x-forwarded-for": "x".repeat(200) }))).toBe("unknown");
  });
});
