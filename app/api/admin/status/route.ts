// GET /api/admin/status … 動画一覧、投票済み人数、発表段階、警告(ログイン済みのときだけ)。
// トークンも、個別の投票内容も返さない。
import { defaultAdminDeps, handleStatus } from "../../../../lib/admin-handlers";

export async function GET(request: Request): Promise<Response> {
  return handleStatus(request, defaultAdminDeps());
}
