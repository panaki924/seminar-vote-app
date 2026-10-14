// 投票用の API(画面から呼ぶ窓口)。
//   GET  /api/vote … 本人確認 + いまの状態(投票中の動画・自分の動画か・送信済みの内容)
//   POST /api/vote … 投票の送信(送信済みなら上書き)
// 本人確認のトークンは、URL ではなく x-vote-token ヘッダーで受け取る
// (URL に入れるとアクセスログやリンクに残りやすいため)。
//
// キャッシュ:リクエストのヘッダーを読むので、毎回リクエストのたびに実行される。
// 念のため、どの返事にも Cache-Control: no-store を付けて、ブラウザや中継にも覚えさせない。
import { getVoteState, submitVote, type ApiResult } from "../../../lib/vote-api";
import { createSupabaseVoteRepo } from "../../../lib/vote-repo";

const TOKEN_HEADER = "x-vote-token";

function respond({ status, body }: ApiResult): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function unexpected(error: unknown): Response {
  // 環境変数の不足など、想定外の失敗。詳しい内容はログにだけ残し、利用者には見せない。
  console.error("[api/vote] 想定外のエラー:", error instanceof Error ? error.message : "unknown");
  return respond({
    status: 500,
    body: {
      ok: false,
      error: "サーバーでエラーが起きました。少し待ってから、もう一度お試しください。",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const repo = createSupabaseVoteRepo();
    return respond(await getVoteState(repo, request.headers.get(TOKEN_HEADER)));
  } catch (error) {
    return unexpected(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = undefined; // JSON として読めない → submitVote 側で「送信内容を読み取れません」にする
    }
    const repo = createSupabaseVoteRepo();
    return respond(await submitVote(repo, request.headers.get(TOKEN_HEADER), body));
  } catch (error) {
    return unexpected(error);
  }
}
