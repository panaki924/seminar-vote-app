// POST /api/admin/logout … セッション Cookie を消す(ログイン済みのときだけ)。
import { defaultAdminDeps, handleLogout } from "../../../../lib/admin-handlers";

export async function POST(request: Request): Promise<Response> {
  return handleLogout(request, defaultAdminDeps());
}
