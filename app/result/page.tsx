// 結果画面 /result。発表段階に応じた順位だけを表示する(誰でも見られる)。
import type { Metadata } from "next";
import { ResultClient } from "./result-client";

export const metadata: Metadata = { title: "結果発表 | ゼミ自己紹介動画" };

export default function ResultPage() {
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-6">
      <h1 className="mb-4 text-xl font-bold">結果発表</h1>
      <ResultClient />
    </main>
  );
}
