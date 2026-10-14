"use client";

// 結果画面の「動き」:2.5秒おきに /api/result を取得して、見た目の部品に渡す(画面が裏の間は止める)。
import { useEffect, useState } from "react";
import type { ResultBody } from "../../lib/result-api";
import { ResultView } from "./result-views";

const POLL_MS = 2500;
const RETRY_MS = 5000;

function parse(json: unknown): ResultBody | null {
  const j = json as Partial<ResultBody> | null;
  if (!j || j.ok !== true || typeof j.stage !== "number" || !Array.isArray(j.places)) return null;
  return j as ResultBody;
}

export function ResultClient() {
  const [result, setResult] = useState<ResultBody | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (ms: number) => { clearTimeout(timer); timer = setTimeout(tick, ms); };
    async function tick() {
      if (stopped || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const res = await fetch("/api/result", { cache: "no-store" });
        const parsed = res.ok ? parse(await res.json()) : null;
        if (stopped) return;
        if (parsed) { setResult(parsed); setError(null); schedule(POLL_MS + Math.random() * 500); }
        else { setError("読み込めませんでした。少し待っています…"); schedule(RETRY_MS); }
      } catch {
        if (!stopped) { setError("通信できませんでした。少し待っています…"); schedule(RETRY_MS); }
      } finally { inFlight = false; }
    }
    const resume = () => { if (!document.hidden) { clearTimeout(timer); void tick(); } };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, []);

  return <ResultView result={result} error={error} />;
}
