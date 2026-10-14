// 管理画面 /admin。ログインしていないときは、パスワードの入力欄を出す(動きは admin-client.tsx)。
// ログインの確認は、画面ではなく、管理 API の 1 本ごとに、サーバーで毎回行う(ここの画面は、見せ方だけ)。
import type { Metadata } from "next";
import { AdminClient } from "./admin-client";

export const metadata: Metadata = {
  title: "管理 | ゼミ自己紹介動画",
};

export default function AdminPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
      <h1 className="mb-4 text-xl font-bold">管理画面</h1>
      <AdminClient />
    </main>
  );
}
