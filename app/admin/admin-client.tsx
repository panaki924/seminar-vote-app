"use client";

// 管理画面の「動き」を担当する部品:ログイン、2〜3秒おきの取得(ポーリング)、各操作、リセットの確認ダイアログ。
// 見た目は admin-views.tsx、判断のロジックは lib/admin-view.ts、通信は lib/admin-client-api.ts に分けてある。
// パスワードは、入力欄の中(この部品の state)にだけあり、送信したらすぐに消す。どこにも保存しない。
import { useCallback, useEffect, useRef, useState } from "react";
import type { VideoAction } from "../../lib/admin-rules";
import {
  changeReveal,
  changeVideo,
  fetchAdminStatus,
  loginRequest,
  logoutRequest,
  resetEverythingRequest,
} from "../../lib/admin-client-api";
import { autoDismissEffect } from "../../lib/auto-dismiss";
import {
  actionResultMessage,
  canConfirmReset,
  feedbackAutoDismissMs,
  lockNotice,
  namesShownAfterStatus,
  type AdminStatus,
} from "../../lib/admin-view";
import { AdminView, type Feedback, type LoginViewState, type ResetDialogState } from "./admin-views";

const POLL_INTERVAL_MS = 2500; // 通常の取得間隔(0〜0.5秒のばらつきを足す)
const POLL_JITTER_MS = 500;
const RETRY_INTERVAL_MS = 5000; // 失敗したあとの間隔
const SESSION_EXPIRED_NOTICE = "ログインの期限が切れました。もう一度ログインしてください。";

type Phase = "checking" | "login" | "dashboard";

const emptyReset = (): ResetDialogState => ({ open: false, typed: "", submitting: false, error: null });

export function AdminClient() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [resetDialog, setResetDialog] = useState<ResetDialogState>(emptyReset);
  // 「まだ投票していない人」の名前を表示している動画の ID。null なら、非表示(初期値)。
  // 投票中の動画が変わると、ID が合わなくなり、自動で非表示に戻る(映したままで、次の動画の名前が出ないように)。
  const [namesShownFor, setNamesShownFor] = useState<string | null>(null);

  // ログインの入力欄
  const [password, setPassword] = useState("");
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [lockMessage, setLockMessage] = useState<string | null>(null);
  const [lockRemaining, setLockRemaining] = useState<number | null>(null); // 残り秒数。null なら止められていない

  // 操作の前後で増やす番号。古い取得結果(操作の前に始まった取得)で、操作後の画面を巻き戻さないために使う。
  const mutationVersionRef = useRef(0);
  const pollNowRef = useRef<(() => void) | null>(null);
  // 取得の途中で「いまの画面の段階」を読むための控え(取得の関数の中では、state が古くなるため)
  const openIdRef = useRef<string | null>(null); // 前回の取得で、投票中だった動画の ID
  const phaseRef = useRef<Phase>("checking");
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const returnToLogin = useCallback((notice: string | null) => {
    setStatus(null);
    setNamesShownFor(null); // ログアウト・期限切れのあとは、名前を非表示に戻す
    openIdRef.current = null;
    setPhase("login");
    setLoginNotice(notice);
    setLoginError(null);
    setFeedback(null);
    setResetDialog(emptyReset());
    setConnectionLost(false);
  }, []);

  // ---------- ポーリング(ログイン画面の間は止める) ----------
  const polling = phase !== "login";
  useEffect(() => {
    if (!polling) return;
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
        const result = await fetchAdminStatus({ signal: controller.signal });
        if (stopped) return;
        if (result.kind === "ok") {
          setConnectionLost(false);
          // 操作の前後に始まった取得の結果は捨てる(次の取得で最新になる)
          if (versionAtStart === mutationVersionRef.current) {
            // 投票中の動画が変わったら、名前の表示を非表示に戻す(同じ動画がまた投票中になっても、勝手に出ない)
            const nextOpenId = result.data.open?.memberId ?? null;
            const previousOpenId = openIdRef.current;
            openIdRef.current = nextOpenId;
            setNamesShownFor((shown) => namesShownAfterStatus(shown, previousOpenId, nextOpenId));
            setStatus(result.data);
            setPhase("dashboard");
          }
          schedule(POLL_INTERVAL_MS + Math.random() * POLL_JITTER_MS);
        } else if (result.kind === "unauthorized") {
          // 画面を開いていた途中なら「期限切れ」、最初の確認なら、ただのログイン画面
          returnToLogin(phaseRef.current === "dashboard" ? SESSION_EXPIRED_NOTICE : null);
        } else if (result.kind === "rejected") {
          // 設定の不備(ADMIN_PASSWORD が未設定など)。何度取りに行っても同じなので、止めて案内を出す
          returnToLogin(null);
          setLoginError(result.message);
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
  }, [polling, returnToLogin]);

  // ---------- 成功のお知らせは、5秒後に自動で消す(「閉じる」も残す) ----------
  // お知らせが入れ替わったとき・この画面が閉じられたときは、後始末の関数が、タイマーを止める。
  useEffect(
    () => autoDismissEffect(feedback, feedback ? feedbackAutoDismissMs(feedback.tone) : null, setFeedback),
    [feedback],
  );

  // ---------- ログインの待ち時間の表示(1秒ずつ減らす) ----------
  useEffect(() => {
    if (lockRemaining === null) return;
    const timer = setTimeout(() => setLockRemaining((r) => (r === null || r <= 1 ? null : r - 1)), 1000);
    return () => clearTimeout(timer);
  }, [lockRemaining]);

  // ---------- リセットのダイアログ:Esc キーで閉じる(送信中は閉じない) ----------
  const resetOpen = resetDialog.open;
  const resetSubmitting = resetDialog.submitting;
  useEffect(() => {
    if (!resetOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !resetSubmitting) setResetDialog(emptyReset());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resetOpen, resetSubmitting]);

  // ---------- ログイン・ログアウト ----------
  const handleLogin = async () => {
    if (loginSubmitting || lockRemaining !== null || password.length === 0) return;
    setLoginSubmitting(true);
    setLoginError(null);
    const result = await loginRequest(password);
    setLoginSubmitting(false);
    setPassword(""); // 成功しても失敗しても、入力したパスワードは、すぐに消す
    switch (result.kind) {
      case "ok":
        setLoginNotice(null);
        setPhase("checking"); // ポーリングが始まり、最初の取得が済むと、管理画面になる
        break;
      case "locked":
        setLockMessage(result.message);
        setLockRemaining(Math.ceil(result.retryAfterSec));
        break;
      default:
        setLoginError(result.message);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    await logoutRequest(); // 失敗しても、この画面からは出る(Cookie は期限で切れる)
    setBusy(false);
    returnToLogin(null);
  };

  // ---------- 操作の共通部分:送信の前後で番号を増やし、終わったら、すぐ最新を取る ----------
  const mutate = async <T,>(run: () => Promise<T>): Promise<T> => {
    mutationVersionRef.current += 1;
    setBusy(true);
    try {
      return await run();
    } finally {
      mutationVersionRef.current += 1;
      setBusy(false);
      pollNowRef.current?.();
    }
  };

  const handleVideoAction = async (memberId: string, action: VideoAction) => {
    const name = status?.videos.find((v) => v.memberId === memberId)?.name ?? memberId;
    const result = await mutate(() => changeVideo({ memberId, action }));
    if (result.kind === "ok") setFeedback({ tone: "success", message: actionResultMessage(action, name) });
    else if (result.kind === "unauthorized") returnToLogin(SESSION_EXPIRED_NOTICE);
    else setFeedback({ tone: "error", message: result.message });
  };

  const handleAdvance = async () => {
    const result = await mutate(() => changeVideo({ action: "advance" }));
    if (result.kind === "ok") {
      setFeedback({ tone: "success", message: result.data.message ?? "動画を切り替えました。" });
    } else if (result.kind === "unauthorized") {
      returnToLogin(SESSION_EXPIRED_NOTICE);
    } else {
      setFeedback({ tone: "error", message: result.message });
    }
  };

  const handleReveal = async (stage: number) => {
    const result = await mutate(() => changeReveal(stage));
    if (result.kind === "ok") {
      const base = `発表段階を「${result.data.revealLabel}」にしました。`;
      const warnings = result.data.warnings.map((w) => w.message).join(" ");
      setFeedback(
        warnings
          ? { tone: "info", message: `${base} 注意:${warnings}` } // 警告は出すが、発表は止めない
          : { tone: "success", message: base },
      );
    } else if (result.kind === "unauthorized") {
      returnToLogin(SESSION_EXPIRED_NOTICE);
    } else {
      setFeedback({ tone: "error", message: result.message });
    }
  };

  // ---------- 全データのリセット ----------
  const handleConfirmReset = async () => {
    if (!canConfirmReset(resetDialog.typed, resetDialog.submitting)) return;
    setResetDialog((d) => ({ ...d, submitting: true, error: null }));
    const typed = resetDialog.typed;
    const result = await mutate(() => resetEverythingRequest(typed));
    if (result.kind === "ok") {
      setResetDialog(emptyReset());
      setFeedback({
        tone: "success",
        message: `リセットしました(投票 ${result.data.deletedVotes} 件を削除し、すべての動画を未放映に戻しました)。`,
      });
    } else if (result.kind === "unauthorized") {
      returnToLogin(SESSION_EXPIRED_NOTICE);
    } else {
      setResetDialog((d) => ({ ...d, submitting: false, error: result.message }));
    }
  };

  const openMemberId = status?.open?.memberId ?? null;
  const showNotVotedNames = openMemberId !== null && namesShownFor === openMemberId;

  const login: LoginViewState = {
    password,
    submitting: loginSubmitting,
    error: loginError,
    // 残り時間は、案内文の中の1か所だけに出す(サーバーの文の「約 N 分後に」は取り除く)
    locked: lockRemaining !== null && lockMessage ? lockNotice(lockMessage, lockRemaining) : null,
    notice: loginNotice,
  };

  return (
    <AdminView
      phase={phase}
      login={login}
      status={status}
      busy={busy}
      feedback={feedback}
      connectionLost={connectionLost}
      resetDialog={resetDialog}
      showNotVotedNames={showNotVotedNames}
      onToggleNotVotedNames={() => setNamesShownFor(showNotVotedNames ? null : openMemberId)}
      onPasswordChange={(value) => {
        setPassword(value);
        setLoginError(null);
      }}
      onLogin={() => void handleLogin()}
      onLogout={() => void handleLogout()}
      onVideoAction={(memberId, action) => void handleVideoAction(memberId, action)}
      onAdvance={() => void handleAdvance()}
      onReveal={(stage) => void handleReveal(stage)}
      onDismissFeedback={() => setFeedback(null)}
      onOpenReset={() => setResetDialog({ open: true, typed: "", submitting: false, error: null })}
      onCancelReset={() => setResetDialog(emptyReset())}
      onResetTyped={(value) => setResetDialog((d) => ({ ...d, typed: value, error: null }))}
      onConfirmReset={() => void handleConfirmReset()}
    />
  );
}
