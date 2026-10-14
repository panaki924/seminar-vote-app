// 投票画面 /v/[token]。URL の token は本人確認用(QR コードで配る)。
// token は「リクエストが来て初めて分かる値」なので、<Suspense> の内側で読む。
// 外側(見出しと「読み込み中」)は、先に表示される静的な殻になる。
import type { Metadata } from "next";
import { Suspense } from "react";
import { VoteClient } from "./vote-client";
import { LoadingCard } from "./vote-views";

export const metadata: Metadata = {
  title: "投票 | ゼミ自己紹介動画",
};

async function TokenGate({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <VoteClient token={token} />;
}

export default function VotePage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-6">
      <h1 className="mb-4 text-xl font-bold">ゼミ自己紹介動画 投票</h1>
      <Suspense fallback={<LoadingCard />}>
        <TokenGate params={params} />
      </Suspense>
    </main>
  );
}
