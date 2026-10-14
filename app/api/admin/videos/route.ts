// POST /api/admin/videos … 動画の状態を切り替える(ログイン済みのときだけ)。open は同時に 1 本だけ。
import { defaultAdminDeps, handleVideos } from "../../../../lib/admin-handlers";

export async function POST(request: Request): Promise<Response> {
  return handleVideos(request, defaultAdminDeps());
}
