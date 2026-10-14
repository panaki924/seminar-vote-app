"use client";

// QR 画面:管理者の名簿を取得して、参加者ごとの QR を並べる。トークンは、画面には文字で出さず、QR の中だけに入れる。
import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { buildVoteUrl, isUnreachableBase, normalizeBaseUrl } from "../../../lib/qr-links";

type Member = { id: string; name: string; nameEn: string; token: string };
type Card = Member & { svg: string };

export function QrClient() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [base, setBase] = useState<string>("");
  const [cards, setCards] = useState<Card[]>([]);

  // 名簿の取得(ログイン済みの Cookie が、自動で付く)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/qr", { cache: "no-store", credentials: "same-origin" });
        if (!alive) return;
        if (res.status === 401) return setUnauthorized(true);
        const json = await res.json();
        if (!res.ok || !json.ok) return setError(json.error ?? "読み込めませんでした。");
        setMembers(json.members as Member[]);
        setBase(window.location.origin); // 先頭の部分は、いま開いているアドレス(手で直せる)
      } catch {
        if (alive) setError("通信できませんでした。");
      }
    })();
    return () => { alive = false; };
  }, []);

  // QR の作成(先頭の部分や名簿が変わるたびに作り直す)
  useEffect(() => {
    if (!members) return;
    let alive = true;
    (async () => {
      const made: Card[] = [];
      for (const m of members) {
        const url = buildVoteUrl(base, m.token);
        const svg = url ? await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) : "";
        made.push({ ...m, svg });
      }
      if (alive) setCards(made);
    })();
    return () => { alive = false; };
  }, [members, base]);

  if (unauthorized) {
    return (
      <p className="rounded-2xl border p-4">
        ログインしていません。<Link href="/admin" className="font-bold underline">管理画面でログイン</Link>してから、このページを開き直してください。
      </p>
    );
  }
  if (error) return <p role="alert" className="rounded-2xl bg-red-50 p-4 text-red-800">{error}</p>;
  if (!members) return <p role="status" className="p-4 text-center">読み込み中…</p>;

  const normalized = normalizeBaseUrl(base);
  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 print:hidden">
        <h1 className="text-xl font-bold">本人確認のQRコード</h1>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">QRコードに入れるアドレスの先頭(公開URL)</span>
          <input
            type="url"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            className="h-12 rounded-xl border border-neutral-300 px-3 text-base dark:border-neutral-600 dark:bg-neutral-950"
          />
        </label>
        {!normalized ? (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">アドレスを読み取れません(https:// から始まる形で入力してください)。</p>
        ) : isUnreachableBase(base) ? (
          <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            このアドレスは、あなたのパソコンの中(または http)のもので、ほかの人のスマホからは開けません。
            配るQRは、公開URL(https://…vercel.app)でこのページを開いて作ってください。
          </p>
        ) : (
          <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">QRの先頭: {normalized}</p>
        )}
        <button
          type="button"
          onClick={() => window.print()}
          className="h-12 rounded-xl bg-indigo-600 text-base font-bold text-white"
        >
          印刷する
        </button>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          印刷したら、1人に1枚ずつ切り分けて配ります。QRコードは本人専用なので、他の人に見せないよう伝えてください。
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-3 print:gap-0">
        {cards.map((c) => (
          <li
            key={c.id}
            data-testid={`qr-${c.id}`}
            className="flex break-inside-avoid flex-col items-center gap-1 rounded-xl border border-neutral-400 bg-white p-3 text-black print:rounded-none print:border-dashed print:p-4"
          >
            <p className="text-lg font-bold">{c.id}</p>
            <p className="text-xl font-bold leading-tight">{c.name}</p>
            <p className="text-xs text-neutral-600">{c.nameEn}</p>
            <div className="mt-1 w-full max-w-[200px]" dangerouslySetInnerHTML={{ __html: c.svg }} />
            <p className="text-xs">スマホで読み取って、投票します</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
