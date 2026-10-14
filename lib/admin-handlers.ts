// 管理 API の「入口」。app/api/admin/*/route.ts は、ここの関数を呼ぶだけの薄い殻にしてある。
//
// 【大事なルール】login 以外のすべての経路は、入口で、毎回、セッションを確かめる(guardAdmin)。
// 公式の認証ガイドにあるとおり、「画面で隠す」「proxy で守る」ではなく、データの近くで、1 本ずつ確かめる。
// 認証に失敗したときは、DB には一切触れない。
import { unstable_rethrow } from "next/navigation";
import {
  clientIpOf,
  isAdminRequest,
  isAllowedOrigin,
  isPasswordStrongEnough,
  LoginLimiter,
  passwordsMatch,
  createSessionToken,
  serializeClearedSessionCookie,
  serializeSessionCookie,
} from "./admin-auth";
import { compareRosterOrder } from "./admin-rules";
import { createSupabaseAdminRepo, listMembersForQr, type QrMember } from "./admin-repo";
import {
  changeRevealStage,
  changeVideoStatus,
  getAdminStatus,
  resetEverything,
  type AdminRepo,
  type ServiceResult,
} from "./admin-service";

export type AdminDeps = {
  /** ADMIN_PASSWORD(環境変数)。未設定なら undefined。 */
  getPassword: () => string | undefined;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  limiter: LoginLimiter;
  /** DB の窓口。認証に成功したあとで、初めて呼ばれる。 */
  getRepo: () => AdminRepo;
  isProduction: boolean;
};

// 同じサーバーの中で、ログイン失敗の記録を共有する(開発中の再読み込みでも消えないよう globalThis に置く)
const globalForLimiter = globalThis as unknown as { __adminLoginLimiter?: LoginLimiter };

export function defaultAdminDeps(): AdminDeps {
  globalForLimiter.__adminLoginLimiter ??= new LoginLimiter();
  return {
    getPassword: () => process.env.ADMIN_PASSWORD,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    limiter: globalForLimiter.__adminLoginLimiter,
    getRepo: () => createSupabaseAdminRepo(),
    isProduction: process.env.NODE_ENV === "production",
  };
}

// ---------- エラー文(日本語。次に何をすればよいかを書く) ----------
const MESSAGES = {
  notLoggedIn: "ログインしていません。ログインし直してください。",
  wrongPassword: "パスワードが違います。もう一度入力してください。",
  badOrigin: "この画面からの操作として確認できませんでした。管理画面を開き直して、もう一度お試しください。",
  notConfigured:
    "管理機能が使えない設定になっています。運営者は、サーバーの設定(ADMIN_PASSWORD)を確認してください。",
  badRequest: "送信内容を読み取れませんでした。画面を更新して、もう一度お試しください。",
  server: "サーバーでエラーが起きました。少し待ってから、もう一度お試しください。",
} as const;

// ---------- 返事の作り方(どの返事も、キャッシュさせない) ----------
function respond(status: number, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0", ...extraHeaders },
  });
}
const respondService = ({ status, body }: ServiceResult) => respond(status, body);
const failBody = (error: string) => ({ ok: false, error });

function unexpected(error: unknown): Response {
  // Next.js が、ビルド中の事前生成を「ここで中断する」ために投げる内部の合図(request.headers を読んだときなど)は、
  // 受け止めずに、そのまま投げ直す。これを握りつぶすと、Next.js の判断が狂う。
  unstable_rethrow(error);
  console.error("[api/admin] 想定外のエラー:", error instanceof Error ? error.message : "unknown");
  return respond(500, failBody(MESSAGES.server));
}

/**
 * 管理 API の入口で、毎回行う確認。通れば null、だめなら、そのまま返す返事。
 *  1. ADMIN_PASSWORD が正しく設定されているか(されていなければ、安全側に倒して、全部断る)
 *  2. 有効な管理者セッション(署名つき Cookie)があるか → なければ 401
 *  3. POST のときは、Origin がこのサイト自身か → 違えば 403
 */
export function guardAdmin(request: Request, deps: AdminDeps, options: { checkOrigin: boolean }): Response | null {
  const password = deps.getPassword();
  if (!isPasswordStrongEnough(password)) return respond(503, failBody(MESSAGES.notConfigured));
  if (options.checkOrigin && !isAllowedOrigin(request.headers)) return respond(403, failBody(MESSAGES.badOrigin));
  if (!isAdminRequest(request, password, deps.now())) return respond(401, failBody(MESSAGES.notLoggedIn));
  return null;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    const text = await request.text();
    if (text.length === 0 || text.length > 10_000) return undefined;
    return JSON.parse(text);
  } catch {
    return undefined; // JSON として読めない → サービス側で「送信内容を読み取れません」にする
  }
}

// ---------- ログイン ----------
export async function handleLogin(request: Request, deps: AdminDeps): Promise<Response> {
  try {
    if (!isAllowedOrigin(request.headers)) return respond(403, failBody(MESSAGES.badOrigin));
    const password = deps.getPassword();
    if (!isPasswordStrongEnough(password)) return respond(503, failBody(MESSAGES.notConfigured));

    // 止めている間は、パスワードを確かめもしない(正しいパスワードでも受け付けない)
    const ip = clientIpOf(request.headers);
    const check = deps.limiter.check(ip, deps.now());
    if (!check.allowed) {
      const minutes = Math.max(1, Math.ceil(check.retryAfterSec / 60));
      const message =
        check.scope === "global"
          ? `短い間にログインの失敗が多かったため、安全のため、ログインを一時的に止めています。約 ${minutes} 分後に、もう一度お試しください。`
          : `ログインの失敗が続いたため、しばらく受け付けられません。約 ${minutes} 分後に、もう一度お試しください。`;
      return respond(429, failBody(message), { "Retry-After": String(check.retryAfterSec) });
    }

    const body = await readJson(request);
    const input = typeof body === "object" && body !== null ? (body as Record<string, unknown>).password : undefined;
    const ok = typeof input === "string" && input.length > 0 && input.length <= 256 && passwordsMatch(input, password);

    if (!ok) {
      // 失敗:記録して、失敗が続くほど長く待たせてから、同じ文面で返す
      const { delayMs } = deps.limiter.recordFailure(ip, deps.now());
      await deps.sleep(delayMs);
      return respond(401, failBody(MESSAGES.wrongPassword));
    }

    deps.limiter.recordSuccess(ip);
    const token = createSessionToken(password, deps.now());
    return respond(200, { ok: true }, { "Set-Cookie": serializeSessionCookie(token, deps.isProduction) });
  } catch (error) {
    return unexpected(error);
  }
}

// ---------- ログアウト ----------
export async function handleLogout(request: Request, deps: AdminDeps): Promise<Response> {
  try {
    const denied = guardAdmin(request, deps, { checkOrigin: true });
    if (denied) return denied;
    return respond(200, { ok: true }, { "Set-Cookie": serializeClearedSessionCookie(deps.isProduction) });
  } catch (error) {
    return unexpected(error);
  }
}

// ---------- いまの状態 ----------
export async function handleStatus(request: Request, deps: AdminDeps): Promise<Response> {
  try {
    const denied = guardAdmin(request, deps, { checkOrigin: false }); // 読むだけの GET
    if (denied) return denied;
    return respondService(await getAdminStatus(deps.getRepo()));
  } catch (error) {
    return unexpected(error);
  }
}

// ---------- 動画の状態の切替 ----------
export async function handleVideos(request: Request, deps: AdminDeps): Promise<Response> {
  try {
    const denied = guardAdmin(request, deps, { checkOrigin: true });
    if (denied) return denied;
    return respondService(await changeVideoStatus(deps.getRepo(), await readJson(request)));
  } catch (error) {
    return unexpected(error);
  }
}

// ---------- QR コード用の名簿(トークンを含む。管理者だけ) ----------
export async function handleQr(
  request: Request,
  deps: AdminDeps,
  listMembers: () => Promise<QrMember[]> = () => listMembersForQr(),
): Promise<Response> {
  try {
    const denied = guardAdmin(request, deps, { checkOrigin: false }); // 読むだけの GET
    if (denied) return denied;
    const members = [...(await listMembers())].sort((a, b) => compareRosterOrder(a.id, b.id));
    return respond(200, { ok: true, members });
  } catch (error) {
    return unexpected(error);
  }
}

// ---------- 結果発表の段階 ----------
export async function handleReveal(request: Request, deps: AdminDeps): Promise<Response> {
  try {
    const denied = guardAdmin(request, deps, { checkOrigin: true });
    if (denied) return denied;
    return respondService(await changeRevealStage(deps.getRepo(), await readJson(request)));
  } catch (error) {
    return unexpected(error);
  }
}

// ---------- 全データのリセット ----------
export async function handleReset(request: Request, deps: AdminDeps): Promise<Response> {
  try {
    const denied = guardAdmin(request, deps, { checkOrigin: true });
    if (denied) return denied;
    return respondService(await resetEverything(deps.getRepo(), await readJson(request)));
  } catch (error) {
    return unexpected(error);
  }
}
