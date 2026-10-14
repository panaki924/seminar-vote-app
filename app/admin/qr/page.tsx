// QR コード画面 /admin/qr(管理者だけ)。参加者ごとの本人確認 QR を、印刷しやすい形で並べる。
import type { Metadata } from "next";
import { QrClient } from "./qr-client";

export const metadata: Metadata = { title: "QRコード | ゼミ自己紹介動画" };

export default function QrPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 print:max-w-none print:p-0">
      <QrClient />
    </main>
  );
}
