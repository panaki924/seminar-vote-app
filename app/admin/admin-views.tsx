// 管理画面の「見た目」だけの部品。状態や通信は持たず、渡された内容をそのまま描く。
// (状態・ポーリング・送信は admin-client.tsx が担当する)
import type { ReactNode } from "react";
import type { RevealWarning, VideoAction } from "../../lib/admin-rules";
import {
  actionLabel,
  actionTone,
  advanceButton,
  canConfirmReset,
  resetSummary,
  RESET_PHRASE,
  revealControls,
  statusLabel,
  voteProgress,
  type AdminStatus,
  type AdminVideoItem,
  type Tone,
} from "../../lib/admin-view";

export type Feedback = { tone: "success" | "error" | "info"; message: string };

export type LoginViewState = {
  password: string;
  submitting: boolean;
  error: string | null;
  /** 失敗が続いて止められているときの案内(残り時間つき)。あれば、入力欄を使えなくする */
  locked: string | null;
  /** 「ログインの期限が切れました」などのお知らせ */
  notice: string | null;
};

export type ResetDialogState = { open: boolean; typed: string; submitting: boolean; error: string | null };

export type AdminViewProps = {
  phase: "checking" | "login" | "dashboard";
  login: LoginViewState;
  status: AdminStatus | null;
  /** 何かの操作を送信中(ボタンを押せなくする) */
  busy: boolean;
  feedback: Feedback | null;
  connectionLost: boolean;
  resetDialog: ResetDialogState;
  onPasswordChange: (value: string) => void;
  onLogin: () => void;
  onLogout: () => void;
  onVideoAction: (memberId: string, action: VideoAction) => void;
  onAdvance: () => void;
  onReveal: (stage: number) => void;
  onDismissFeedback: () => void;
  onOpenReset: () => void;
  onCancelReset: () => void;
  onResetTyped: (value: string) => void;
  onConfirmReset: () => void;
};

const card =
  "rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900";

const buttonBase =
  "inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const TONE_CLASSES: Record<Tone, string> = {
  primary: "bg-indigo-600 text-white enabled:active:bg-indigo-800 disabled:bg-neutral-300 disabled:text-neutral-500 dark:disabled:bg-neutral-700 dark:disabled:text-neutral-400",
  neutral: "border border-neutral-300 text-neutral-900 enabled:active:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-100 dark:enabled:active:bg-neutral-800",
  danger: "border border-red-300 text-red-700 enabled:active:bg-red-50 dark:border-red-800 dark:text-red-300 dark:enabled:active:bg-red-950",
};
const buttonClass = (tone: Tone, extra = "") => `${buttonBase} ${TONE_CLASSES[tone]} ${extra}`.trim();

const BADGE_CLASSES = {
  pending: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  open: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
  closed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  not_shown: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
} as const;

// ---------- ログイン ----------
function LoginForm({ login, onPasswordChange, onLogin }: Pick<AdminViewProps, "login" | "onPasswordChange" | "onLogin">) {
  const locked = login.locked !== null;
  const canSubmit = !locked && !login.submitting && login.password.length > 0;
  return (
    <form
      className={`${card} flex flex-col gap-4`}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onLogin();
      }}
    >
      <h2 className="text-xl font-bold">管理者ログイン</h2>
      {login.notice ? (
        <p role="status" className="rounded-xl bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-950 dark:text-sky-100">
          {login.notice}
        </p>
      ) : null}
      <label className="flex flex-col gap-2">
        <span className="text-base font-medium">パスワード</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          value={login.password}
          onChange={(event) => onPasswordChange(event.target.value)}
          disabled={locked || login.submitting}
          className="h-12 rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-600 dark:bg-neutral-950"
        />
      </label>
      {login.locked ? (
        <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {login.locked}
        </p>
      ) : null}
      {login.error ? (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {login.error}
        </p>
      ) : null}
      <button type="submit" disabled={!canSubmit} className={buttonClass("primary", "h-12 w-full text-lg")}>
        {login.submitting ? "確認しています…" : "ログイン"}
      </button>
    </form>
  );
}

// ---------- 投票中の動画 ----------
function OpenVideoCard({ status, busy, onAdvance }: { status: AdminStatus; busy: boolean; onAdvance: () => void }) {
  const open = status.open;
  const advance = advanceButton(status.advance);
  const progress = open ? voteProgress(open.voteCount, open.eligibleCount) : null;
  return (
    <section className={card} aria-label="投票中の動画">
      <h2 className="text-sm font-medium text-indigo-700 dark:text-indigo-300">投票中の動画</h2>
      {open && progress ? (
        <>
          <p className="mt-1 text-2xl font-bold leading-tight">{open.name}</p>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">{open.nameEn}</p>
          <div className="mt-3">
            <p className="text-lg font-semibold" data-testid="open-progress-text">{progress.text}</p>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress.percent}
              aria-label="投票の進み具合"
              className="mt-1 h-3 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700"
            >
              <div
                className={`h-full rounded-full ${progress.complete ? "bg-emerald-500" : "bg-indigo-500"}`}
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            {open.notVotedNames.length > 0 ? (
              <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300" data-testid="not-voted">
                まだ投票していない人:{open.notVotedNames.join("、")}
              </p>
            ) : (
              <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">全員が投票済みです。</p>
            )}
          </div>
        </>
      ) : (
        <p className="mt-1 text-lg font-semibold">いま投票中の動画はありません</p>
      )}
      <button
        type="button"
        data-testid="advance-button"
        onClick={onAdvance}
        disabled={busy || !advance.enabled}
        className={buttonClass("primary", "mt-4 h-14 w-full text-lg")}
      >
        {advance.label}
      </button>
    </section>
  );
}

// ---------- 動画の一覧 ----------
function VideoRow({ video, busy, onAction }: { video: AdminVideoItem; busy: boolean; onAction: AdminViewProps["onVideoAction"] }) {
  const showVotes = video.status === "open" || video.status === "closed" || video.voteCount > 0;
  return (
    <li data-testid={`video-row-${video.memberId}`} className="flex flex-col gap-2 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-neutral-500">{video.memberId}</p>
          <p className="text-lg font-semibold leading-tight">{video.name}</p>
          {showVotes ? (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              票 {video.voteCount} / {video.eligibleCount}
            </p>
          ) : null}
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${BADGE_CLASSES[video.status]}`}>
          {statusLabel(video.status)}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {video.actions.map((item) => (
          <div key={item.action} className="flex flex-col">
            <button
              type="button"
              data-testid={`action-${video.memberId}-${item.action}`}
              onClick={() => onAction(video.memberId, item.action)}
              disabled={busy || !item.enabled}
              className={buttonClass(actionTone(item.action), "min-w-24")}
            >
              {actionLabel(item.action)}
            </button>
          </div>
        ))}
      </div>
      {video.actions.some((a) => !a.enabled && a.reason) ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {video.actions.find((a) => !a.enabled && a.reason)?.reason}
        </p>
      ) : null}
    </li>
  );
}

function VideoList({ status, busy, onAction }: { status: AdminStatus; busy: boolean; onAction: AdminViewProps["onVideoAction"] }) {
  return (
    <section className={card} aria-label="動画の一覧">
      <h2 className="text-lg font-bold">動画の一覧(放映順)</h2>
      <ul className="mt-1 divide-y divide-neutral-200 dark:divide-neutral-800">
        {status.videos.map((video) => (
          <VideoRow key={video.memberId} video={video} busy={busy} onAction={onAction} />
        ))}
      </ul>
    </section>
  );
}

// ---------- 結果の発表 ----------
function WarningList({ warnings }: { warnings: RevealWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul data-testid="reveal-warnings" className="mt-3 flex flex-col gap-2" aria-label="発表前の警告">
      {warnings.map((w) => (
        <li key={w.code} role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          ⚠ {w.message}
        </li>
      ))}
    </ul>
  );
}

function RevealPanel({ status, busy, onReveal }: { status: AdminStatus; busy: boolean; onReveal: (stage: number) => void }) {
  const controls = revealControls(status.revealStage);
  return (
    <section className={card} aria-label="結果の発表">
      <h2 className="text-lg font-bold">結果の発表</h2>
      <p className="mt-1 text-base">
        いまの段階:<span className="font-bold" data-testid="reveal-label">{status.revealLabel}</span>
        <span className="ml-2 text-sm text-neutral-600 dark:text-neutral-400">({status.revealStage} / 3)</span>
      </p>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">順位の対象:{status.rankedCount} 名</p>
      {controls.next.enabled ? <WarningList warnings={status.warnings} /> : null}
      <div className="mt-3 flex flex-col gap-2">
        <button
          type="button"
          data-testid="reveal-next"
          onClick={() => onReveal(controls.next.targetStage)}
          disabled={busy || !controls.next.enabled}
          className={buttonClass("primary", "h-12 w-full")}
        >
          {controls.next.label}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            data-testid="reveal-back"
            onClick={() => onReveal(controls.back.targetStage)}
            disabled={busy || !controls.back.enabled}
            className={buttonClass("neutral", "w-full")}
          >
            {controls.back.label}
          </button>
          <button
            type="button"
            data-testid="reveal-hide"
            onClick={() => onReveal(controls.hide.targetStage)}
            disabled={busy || !controls.hide.enabled}
            className={buttonClass("neutral", "w-full")}
          >
            {controls.hide.label}
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------- 危険な操作(リセット) ----------
function DangerZone({ status, busy, onOpenReset }: { status: AdminStatus; busy: boolean; onOpenReset: () => void }) {
  return (
    <section className="rounded-2xl border-2 border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950" aria-label="危険な操作">
      <h2 className="text-lg font-bold text-red-800 dark:text-red-200">危険な操作</h2>
      <p className="mt-1 text-sm text-red-900 dark:text-red-100">
        すべての投票を削除し、動画を未放映に戻します。元に戻せません(現在、投票 {status.totals.votes} 件)。
      </p>
      <button
        type="button"
        data-testid="reset-open"
        onClick={onOpenReset}
        disabled={busy}
        className={buttonClass("danger", "mt-3 h-12 w-full bg-white dark:bg-transparent")}
      >
        全データのリセット…
      </button>
    </section>
  );
}

export function ResetDialog({
  state,
  totals,
  onCancel,
  onTyped,
  onConfirm,
}: {
  state: ResetDialogState;
  totals: { votes: number };
  onCancel: () => void;
  onTyped: (value: string) => void;
  onConfirm: () => void;
}) {
  if (!state.open) return null;
  const confirmable = canConfirmReset(state.typed, state.submitting);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="reset-title" data-testid="reset-dialog" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-neutral-900">
        <h2 id="reset-title" className="text-xl font-bold text-red-700 dark:text-red-300">全データをリセットしますか?</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
          {resetSummary(totals).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <label className="mt-4 flex flex-col gap-2">
          <span className="text-sm font-medium">確認のため、「{RESET_PHRASE}」と入力してください</span>
          <input
            type="text"
            data-testid="reset-input"
            value={state.typed}
            onChange={(event) => onTyped(event.target.value)}
            disabled={state.submitting}
            autoComplete="off"
            className="h-12 rounded-xl border border-neutral-300 bg-white px-3 text-base dark:border-neutral-600 dark:bg-neutral-950"
          />
        </label>
        {state.error ? (
          <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            {state.error}
          </p>
        ) : null}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" data-testid="reset-cancel" onClick={onCancel} disabled={state.submitting} className={buttonClass("neutral", "h-12")}>
            キャンセル
          </button>
          <button
            type="button"
            data-testid="reset-confirm"
            onClick={onConfirm}
            disabled={!confirmable}
            className="inline-flex h-12 items-center justify-center rounded-xl bg-red-600 px-4 text-base font-bold text-white transition-colors enabled:active:bg-red-800 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-500 dark:disabled:bg-neutral-700"
          >
            {state.submitting ? "リセット中…" : "リセットする"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- 全体 ----------
export function AdminLoading() {
  return (
    <div className={card} role="status" aria-live="polite">
      <p className="text-center text-lg">確認しています…</p>
    </div>
  );
}

const FEEDBACK_CLASSES: Record<Feedback["tone"], string> = {
  success: "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  error: "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200",
  info: "bg-sky-50 text-sky-900 dark:bg-sky-950 dark:text-sky-100",
};

export function AdminView(props: AdminViewProps) {
  const { phase, status } = props;

  let body: ReactNode;
  if (phase === "checking") {
    body = <AdminLoading />;
  } else if (phase === "login" || status === null) {
    body = <LoginForm login={props.login} onPasswordChange={props.onPasswordChange} onLogin={props.onLogin} />;
  } else {
    body = (
      <>
        {props.feedback ? (
          <div
            role={props.feedback.tone === "error" ? "alert" : "status"}
            data-testid="feedback"
            className={`flex items-start justify-between gap-3 rounded-xl p-3 text-sm ${FEEDBACK_CLASSES[props.feedback.tone]}`}
          >
            <p>{props.feedback.message}</p>
            <button type="button" onClick={props.onDismissFeedback} className="shrink-0 font-semibold underline">
              閉じる
            </button>
          </div>
        ) : null}
        <OpenVideoCard status={status} busy={props.busy} onAdvance={props.onAdvance} />
        <VideoList status={status} busy={props.busy} onAction={props.onVideoAction} />
        <RevealPanel status={status} busy={props.busy} onReveal={props.onReveal} />
        <DangerZone status={status} busy={props.busy} onOpenReset={props.onOpenReset} />
        <ResetDialog
          state={props.resetDialog}
          totals={status.totals}
          onCancel={props.onCancelReset}
          onTyped={props.onResetTyped}
          onConfirm={props.onConfirmReset}
        />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {phase === "dashboard" && status !== null ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">この画面は自動で更新されます</p>
          <button type="button" data-testid="logout" onClick={props.onLogout} className={buttonClass("neutral", "min-h-10 px-3 text-sm")}>
            ログアウト
          </button>
        </div>
      ) : null}
      {phase !== "login" && props.connectionLost ? (
        <p role="status" data-testid="connection-lost" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {status !== null
            ? "接続を確認しています…(最後に取得した内容を表示しています)"
            : "サーバーにつながっていません。ネットワークを確かめてください(自動で、もう一度つなぎ直します)。"}
        </p>
      ) : null}
      {body}
    </div>
  );
}
