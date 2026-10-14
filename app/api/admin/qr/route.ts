// GET /api/admin/qr … QR コード用の名簿(学籍番号・氏名・トークン)。ログイン済みの管理者だけ。
import { defaultAdminDeps, handleQr } from "../../../../lib/admin-handlers";

export async function GET(request: Request): Promise<Response> {
  return handleQr(request, defaultAdminDeps());
}
