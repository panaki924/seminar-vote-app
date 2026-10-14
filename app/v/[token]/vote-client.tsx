"use client";

// 投票画面の「動き」を担当する部品:2〜3秒おきの取得(ポーリング)、点数の入力、送信。
// 見た目は vote-views.tsx、判断のロジックは lib/vote-view.ts に分けてある。
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchVoteState, submitVoteRequest } from "../../../lib/vote-client-api";
import {
  canSubmit,
  deriveScreen,
  draftForVideo,
  draftFromVote,
  emptyDraft,
  formatSentTime,
  isDraftComplete,
  setScore,
  submitHint,
  videoSwitched,
  type Criterion,
  type Draft,
  type Score,
  type VoteSnapshot,
} from "../../../lib/vote-view";
import { ScreenView } from "./vote-views";

const POLL_INTERVAL_MS = 2500; // 通常の取得間隔(ここに 0〜0.5 秒のばらつきを足す)
const POLL_JITTER_MS = 500; // 全員が同じ瞬間に取得しないようにする
const RETRY_INTERVAL_MS = 5000; // 失敗したあとの間隔

export function VoteClient({ token }: { token: string }) {
  const [snapshot, setSnapshot] = useState<VoteSnapshot | null>(null);
  const [fatalMessage, setFatalMessage] = useState<string | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const [draftState, setDraftState] = useState<{ videoId: string | null; draft: Draft }>({
    videoId: null,
    draft: emptyDraft(),
  });
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [justSentTime, setJustSentTime] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const currentVideoIdRef = useRef<string | null>(null);
  // 送信の前後で増やす番号。古い取得結果(送信前に始まった取得)で、送信後の画面を巻き戻さないために使う。
  const mutationVersionRef = useRef(0);
  const pollNowRef = useRef<(() => void) | null>(null);

  // 取得した状態を画面に反映する
  const applySnapshot = useCallback((next: VoteSnapshot) => {
    const previousId = currentVideoIdRef.current;
    const nextId = next.current?.videoId ?? null;
    currentVideoIdRef.current = nextId;

    setSnapshot(next);
    // 動画が同じ間は入力中の点数を残し、切り替わったときだけ空に戻す
    setDraftState((s) => ({ videoId: nextId, draft: draftForVideo(s.draft, s.videoId, nextId) }));

    if (previousId !== nextId) {
      setEditing(false);
      setSubmitError(null);
      setJustSentTime(null);
      setNotice(
        videoSwitched(previousId, nextId) && next.current
          ? `投票中の動画が「${next.current.name}」に切り替わりました。`
          : null,
      );
    }
  }, []);

  // ---------- ポーリング ----------
  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(tick, ms);
    };

    async function tick() {
      if (stopped || inFlight) return;
      if (document.hidden) return; // 画面が裏に回っている間は取りに行かない(戻ったときに再開する)
      inFlight = true;
      controller = new AbortController();
      const versionAtStart = mutationVersionRef.current;
      try {
        const result = await fetchVoteState(token, { signal: controller.signal });
        if (stopped) return;
        if (result.kind === "ok") {
          setConnectionLost(false);
          // 送信の前後に始まった取得の結果は捨てる(次の取得で最新になる)
          if (versionAtStart === mutationVersionRef.current) applySnapshot(result.snapshot);
          schedule(POLL_INTERVAL_MS + Math.random() * POLL_JITTER_MS);
        } else if (result.kind === "unauthorized") {
          setFatalMessage(result.message); // 本人確認できない。何度取りに行っても同じなので止める
        } else {
          setConnectionLost(true); // 最後に取得できた内容を表示したまま、少し待って再試行する
          schedule(RETRY_INTERVAL_MS);
        }
      } catch {
        // 中断(画面を離れた)など。何もしない
      } finally {
        inFlight = false;
      }
    }

    const pollNow = () => {
      clearTimeout(timer);
      void tick();
    };
    pollNowRef.current = pollNow;

    const onVisibilityChange = () => {
      if (!document.hidden) pollNow(); // 画面に戻ったら、すぐに最新を取る
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", pollNow);
    void tick();

    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", pollNow);
      pollNowRef.current = null;
    };
  }, [token, applySnapshot]);

  // ---------- 画面の決定 ----------
  const screen = deriveScreen({ snapshot, fatalMessage, editing });
  const currentVideoId = snapshot?.current?.videoId ?? null;
  const draft = draftForVideo(draftState.draft, draftState.videoId, currentVideoId);
  const existingVote = snapshot?.myVote ?? null;
  const formActive = screen.kind === "form";
  const canSubmitNow = formActive && canSubmit(draft, existingVote, sending);
  const hint = formActive ? submitHint(draft, existingVote, sending) : null;

  // ---------- 操作 ----------
  const handleSelect = (criterion: Criterion, value: Score) => {
    setDraftState((s) => ({ ...s, draft: setScore(s.draft, criterion, value) }));
    setSubmitError(null);
  };

  const handleStartEdit = () => {
    if (!snapshot?.current) return;
    setDraftState({ videoId: snapshot.current.videoId, draft: draftFromVote(snapshot.myVote) });
    setEditing(true);
    setJustSentTime(null);
    setSubmitError(null);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setSubmitError(null);
  };

  const handleSubmit = async () => {
    if (screen.kind !== "form" || !isDraftComplete(draft) || !canSubmitNow) return;
    const target = screen.video.videoId;
    mutationVersionRef.current += 1;
    setSending(true);
    setSubmitError(null);

    const result = await submitVoteRequest(token, { targetId: target, tech: draft.tech, impact: draft.impact });

    mutationVersionRef.current += 1;
    setSending(false);
    switch (result.kind) {
      case "ok":
        setSnapshot((s) => (s ? { ...s, myVote: result.vote } : s));
        setEditing(false);
        setJustSentTime(formatSentTime(result.vote.updatedAt));
        break;
      case "rejected":
        setSubmitError(result.message);
        if (result.status === 409) pollNowRef.current?.(); // 動画が切り替わった・締切になったので、すぐ最新を取る
        break;
      case "unauthorized":
        setFatalMessage(result.message);
        break;
      case "error":
        setSubmitError(result.message); // 選んだ点数は残してあるので、もう一度押せる
        break;
    }
  };

  return (
    <ScreenView
      screen={screen}
      draft={draft}
      sending={sending}
      canSubmitNow={canSubmitNow}
      hint={hint}
      submitError={submitError}
      justSentTime={justSentTime}
      notice={notice}
      connectionLost={connectionLost}
      onSelect={handleSelect}
      onSubmit={() => void handleSubmit()}
      onStartEdit={handleStartEdit}
      onCancelEdit={handleCancelEdit}
      onDismissNotice={() => setNotice(null)}
    />
  );
}
