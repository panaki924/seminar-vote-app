// POST /api/admin/login … 管理者パスワードを確かめて、セッション Cookie を渡す(これだけは、ログイン前に呼ばれる)。
import { defaultAdminDeps, handleLogin } from "../../../../lib/admin-handlers";

export async function POST(request: Request): Promise<Response> {
  return handleLogin(request, defaultAdminDeps());
}
