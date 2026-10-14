// GET /api/result … 発表段階に応じた順位だけを返す(誰でも見られる。投票内容・トークンは返さない)。
import { connection } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { createSupabaseAdminRepo } from "../../../lib/admin-repo";
import { getResult } from "../../../lib/result-api";

export async function GET(): Promise<Response> {
  try {
    await connection(); // リクエストのたびに実行する(ビルド時に、結果を作って固めてしまわない)
    const { status, body } = await getResult(createSupabaseAdminRepo());
    return Response.json(body, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    unstable_rethrow(error); // Next.js の内部の合図は、握りつぶさず投げ直す
    console.error("[api/result] 想定外のエラー:", error instanceof Error ? error.message : "unknown");
    return Response.json(
      { ok: false, error: "サーバーでエラーが起きました。少し待ってから、もう一度お試しください。" },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
