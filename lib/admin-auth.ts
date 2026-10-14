// 管理者の認証に使う部品(サーバー専用)。Next.js にも DB にも依存しない。
//  ・パスワードの照合(時間から情報が漏れない比較)
//  ・署名つきセッション Cookie(作る・確かめる)
//  ・POST の Origin の確認
//  ・ログイン失敗の待ち時間と、IP ごと・全体の制限
// パスワードの値は、戻り値にも例外にも、ログにも出さない。
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const MIN_PASSWORD_LENGTH = 12;
export const SESSION_COOKIE_NAME = "admin_session";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8時間

// ---------- 1. パスワード ----------
/** 管理者パスワードとして使える長さか(短いものは、ログインを断る)。 */
export function isPasswordStrongEnough(password: unknown): password is string {
  return typeof password === "string" && password.length >= MIN_PASSWORD_LENGTH;
}

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest();

/**
 * 入力と、正しいパスワードを比べる。
 * どちらも SHA-256 にして同じ長さにしてから、timingSafeEqual で比べる
 * (長さの違いや、どこまで合っているかが、応答時間から分からないようにするため)。
 */
export function passwordsMatch(input: unknown, expected: string): boolean {
  if (typeof input !== "string") return false;
  return timingSafeEqual(sha256(input), sha256(expected));
}

// ---------- 2. 署名つきセッション Cookie ----------
// 形式:  <期限(秒)>.<乱数>.<署名>
// 署名の鍵は ADMIN_PASSWORD から作る。パスワードを変えると、すべてのセッションが無効になる。
function signingKey(password: string): Buffer {
  return createHmac("sha256", password).update("seminar-vote/admin-session/v1", "utf8").digest();
}

function sign(payload: string, password: string): string {
  return createHmac("sha256", signingKey(password)).update(payload, "utf8").digest("base64url");
}

export function createSessionToken(password: string, nowMs: number = Date.now()): string {
  const expSec = Math.floor((nowMs + SESSION_TTL_MS) / 1000);
  const nonce = randomBytes(16).toString("base64url");
  const payload = `${expSec}.${nonce}`;
  return `${payload}.${sign(payload, password)}`;
}

/** セッションの Cookie の値が、正しく署名されていて、期限内かを確かめる。改ざん・期限切れ・形式違いは false。 */
export function verifySessionToken(
  token: string | null | undefined,
  password: string,
  nowMs: number = Date.now(),
): boolean {
  if (typeof token !== "string" || token.length === 0 || token.length > 200) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expText, nonce, signature] = parts;
  if (!/^\d{1,12}$/.test(expText) || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) {
    return false;
  }
  const expected = Buffer.from(sign(`${expText}.${nonce}`, password));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;

  const expMs = Number(expText) * 1000;
  // 期限が過ぎていない、かつ、遠い未来の期限(想定の有効期間を超える)ではない
  return expMs > nowMs && expMs - nowMs <= SESSION_TTL_MS + 60_000;
}

/** Cookie ヘッダーから、名前を指定して値を取り出す。 */
export function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const raw = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/** リクエストが、有効な管理者セッションを持っているか。 */
export function isAdminRequest(request: Request, password: string, nowMs: number = Date.now()): boolean {
  return verifySessionToken(readCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME), password, nowMs);
}

/** Cookie の設定。本番(https)では Secure をつける。 */
export function sessionCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true, // JavaScript から読めない
    sameSite: "strict" as const, // 別のサイトからの通信には付かない
    secure: isProduction, // 本番では、https のときだけ送る
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}

// ---------- 3. POST の Origin の確認 ----------
const firstValue = (header: string | null) => (header ?? "").split(",")[0].trim().toLowerCase();

/**
 * ブラウザが付けた Origin(どのサイトの画面からの通信か)が、このサイト自身か。
 *  ・Origin が無いとき:許す(ブラウザ以外の道具の通信。ブラウザの他サイトからの POST には必ず付く)。
 *  ・Origin があるとき:Origin のホスト(ポート込み)が、Host ヘッダー、または X-Forwarded-Host と同じなら許す。
 *    - 本番(https)、localhost(ポート違いは別とみなす)、
 *    - 中継サーバーが Host を書き換えても、X-Forwarded-Host を付けていれば許す。
 *  ・"null"、読み取れない値、ホストが違うもの(似た名前・別のポート・サブドメイン)は断る。
 * 比べるのはホスト(ポート込み)だけで、http か https かは見ない(SameSite=Strict の Cookie が別に守る)。
 */
export function isAllowedOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  if (origin === null) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase(); // 標準のポート(443 / 80)は、取り除かれる
  } catch {
    return false;
  }
  if (!originHost) return false;
  const candidates = [firstValue(headers.get("host")), firstValue(headers.get("x-forwarded-host"))].filter(Boolean);
  return candidates.includes(originHost);
}

// ---------- 4. ログイン失敗の待ち時間と制限 ----------
export type LimiterOptions = {
  ipMaxFailures: number; // 同じ IP から、この回数失敗したら止める
  ipWindowMs: number;
  ipBlockMs: number;
  globalMaxFailures: number; // 全体で、この回数失敗したら、全員を止める(IP の偽装対策)
  globalWindowMs: number;
  globalBlockMs: number;
  maxTrackedIps: number; // 覚えておく IP の数の上限(偽装で、メモリを使い切られないため)
  baseDelayMs: number; // 失敗したときの待ち時間(1回目)。2回目から倍々
  maxDelayMs: number;
};

export const DEFAULT_LIMITER_OPTIONS: LimiterOptions = {
  ipMaxFailures: 5,
  ipWindowMs: 15 * 60_000,
  ipBlockMs: 10 * 60_000,
  globalMaxFailures: 30,
  globalWindowMs: 15 * 60_000,
  globalBlockMs: 10 * 60_000,
  maxTrackedIps: 1000,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
};

export type LimiterCheck =
  | { allowed: true }
  | { allowed: false; scope: "ip" | "global"; retryAfterSec: number };

/**
 * ログイン失敗の記録と制限(メモリ上)。時刻は引数で受け取るので、テストで確かめられる。
 * サーバーが再起動したり複数台に分かれたりすると、記録が共有されない。
 * あくまで、速度を落とす仕組み。本当の守りは、長くて推測できないパスワード。
 */
export class LoginLimiter {
  private readonly options: LimiterOptions;
  private readonly ipFailures = new Map<string, number[]>();
  private readonly ipBlockedUntil = new Map<string, number>();
  private globalFailures: number[] = [];
  private globalBlockedUntil = 0;

  constructor(options: Partial<LimiterOptions> = {}) {
    this.options = { ...DEFAULT_LIMITER_OPTIONS, ...options };
  }

  /** いま、この IP のログインを受け付けてよいか(止めているなら、残り秒数つき)。 */
  check(ip: string, now: number): LimiterCheck {
    if (now < this.globalBlockedUntil) {
      return { allowed: false, scope: "global", retryAfterSec: Math.ceil((this.globalBlockedUntil - now) / 1000) };
    }
    const until = this.ipBlockedUntil.get(ip);
    if (until !== undefined) {
      if (now < until) return { allowed: false, scope: "ip", retryAfterSec: Math.ceil((until - now) / 1000) };
      this.ipBlockedUntil.delete(ip);
    }
    return { allowed: true };
  }

  /** 失敗を記録する。返す delayMs は、返事の前に待つ時間(失敗が続くほど長い)。 */
  recordFailure(ip: string, now: number): { delayMs: number } {
    const { options } = this;

    const ipList = (this.ipFailures.get(ip) ?? []).filter((t) => now - t < options.ipWindowMs);
    ipList.push(now);
    const delayMs = Math.min(options.baseDelayMs * 2 ** (ipList.length - 1), options.maxDelayMs);
    if (ipList.length >= options.ipMaxFailures) {
      this.ipBlockedUntil.set(ip, now + options.ipBlockMs);
      this.ipFailures.delete(ip); // 止めたあとは、新しく数え直す
    } else {
      this.ipFailures.set(ip, ipList);
    }

    this.globalFailures = this.globalFailures.filter((t) => now - t < options.globalWindowMs);
    this.globalFailures.push(now);
    if (this.globalFailures.length >= options.globalMaxFailures) {
      this.globalBlockedUntil = now + options.globalBlockMs;
      this.globalFailures = [];
    }

    this.trimTrackedIps(now);
    return { delayMs };
  }

  /** いま覚えている IP の数(メモリの使いすぎを防げているかの確認用)。 */
  trackedIpCount(): number {
    return this.ipFailures.size + this.ipBlockedUntil.size;
  }

  /** 成功したら、その IP の失敗の記録を消す(全体の失敗の数は、減らさない)。 */
  recordSuccess(ip: string): void {
    this.ipFailures.delete(ip);
  }

  private trimTrackedIps(now: number): void {
    for (const [ip, until] of this.ipBlockedUntil) if (now >= until) this.ipBlockedUntil.delete(ip);
    while (this.ipFailures.size + this.ipBlockedUntil.size > this.options.maxTrackedIps) {
      // 古いものから忘れる(全体の上限が、IP の偽装を別に止める)
      const oldest = this.ipFailures.keys().next().value ?? this.ipBlockedUntil.keys().next().value;
      if (oldest === undefined) break;
      if (!this.ipFailures.delete(oldest)) this.ipBlockedUntil.delete(oldest);
    }
  }
}

/** リクエストの接続元 IP(x-forwarded-for の先頭)。偽装されうるので、全体の上限と組み合わせて使う。 */
export function clientIpOf(headers: Headers): string {
  const first = (headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  return first && first.length <= 64 ? first : "unknown";
}
