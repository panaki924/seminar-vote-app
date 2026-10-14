// POST /api/admin/reset … 全データのリセット(ログイン済みで、確認の合言葉があるときだけ)。元に戻せない。
import { defaultAdminDeps, handleReset } from "../../../../lib/admin-handlers";

export async function POST(request: Request): Promise<Response> {
  return handleReset(request, defaultAdminDeps());
}
