// POST /api/admin/reveal … 結果発表の段階(0〜3)を変える(ログイン済みのときだけ)。
import { defaultAdminDeps, handleReveal } from "../../../../lib/admin-handlers";

export async function POST(request: Request): Promise<Response> {
  return handleReveal(request, defaultAdminDeps());
}
