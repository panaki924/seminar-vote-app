// 結果画面の見た目だけの部品(渡された内容を描くだけ)。
import type { ResultBody } from "../../lib/result-api";

export type ResultViewProps = { result: ResultBody | null; error: string | null };

const card = "rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900";
const RANK_STYLE: Record<number, string> = {
  1: "bg-amber-400 text-amber-950",
  2: "bg-neutral-300 text-neutral-900",
  3: "bg-orange-300 text-orange-950",
};

export function ResultView({ result, error }: ResultViewProps) {
  if (result === null) {
    return (
      <div className={card} role="status">
        <p className="text-center text-lg">{error ?? "読み込み中…"}</p>
      </div>
    );
  }
  if (result.stage === 0 || result.places.length === 0) {
    return (
      <div className={card} role="status" data-testid="waiting">
        <p className="text-center text-xl font-bold">結果発表をお待ちください</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">接続を確認しています…(最後に取得した内容を表示しています)</p>
      ) : null}
      {result.places.map((place) => (
        <section key={place.rank} className={card} data-testid={`place-${place.rank}`} aria-label={`${place.rank}位`}>
          <div className="flex items-center gap-3">
            <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-3xl font-black ${RANK_STYLE[place.rank] ?? "bg-neutral-200"}`}>
              {place.rank}
            </span>
            <h2 className="text-lg font-bold">{place.rank}位</h2>
          </div>
          {place.entries.length === 0 ? (
            <p className="mt-3 text-base" data-testid={`empty-${place.rank}`}>
              該当者なし(同順位のため{place.rank}位はいません)
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {place.entries.map((e) => (
                <li key={e.name} className="border-t border-neutral-200 pt-3 first:border-t-0 first:pt-0 dark:border-neutral-800">
                  <p className="text-2xl font-bold leading-tight">{e.name}</p>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400">{e.nameEn}</p>
                  <p className="mt-1 text-xl font-semibold">総合 {e.total.toFixed(2)} 点</p>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400">
                    技術 {e.techAvg.toFixed(2)} + インパクト {e.impactAvg.toFixed(2)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
