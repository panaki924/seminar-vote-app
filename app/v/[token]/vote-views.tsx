// 投票画面の「見た目」だけの部品。状態や通信は持たず、渡された内容をそのまま描く。
// (状態・ポーリング・送信は vote-client.tsx が担当する)
import type { ReactNode } from "react";
import {
  CRITERIA,
  SCALE_HIGH_LABEL,
  SCALE_LOW_LABEL,
  SCORES,
  type Criterion,
  type CurrentVideo,
  type Draft,
  type Score,
  type Screen,
  formatSentTime,
} from "../../../lib/vote-view";

export type ScreenViewProps = {
  screen: Screen;
  draft: Draft;
  sending: boolean;
  /** 送信ボタンを押せるか(vote-view.ts の canSubmit の結果) */
  canSubmitNow: boolean;
  /** 送信ボタンの下の案内文(押せるときは null) */
  hint: string | null;
  /** 送信に失敗した・断られたときのメッセージ */
  submitError: string | null;
  /** 送信直後に「送信しました」を大きく出すための送信時刻(日本時間の文字列) */
  justSentTime: string | null;
  /** 「動画が切り替わりました」などのお知らせ */
  notice: string | null;
  /** 通信が途切れているか */
  connectionLost: boolean;
  onSelect: (criterion: Criterion, value: Score) => void;
  onSubmit: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onDismissNotice: () => void;
};

const card =
  "rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900";

// ---------- 画面の外枠 ----------
export function PageFrame({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4">{children}</div>;
}

export function LoadingCard() {
  return (
    <div className={card} role="status" aria-live="polite">
      <p className="text-center text-lg">読み込み中…</p>
    </div>
  );
}

function Greeting({ voterName }: { voterName: string }) {
  return (
    <p className="text-sm text-neutral-600 dark:text-neutral-400">
      <span className="font-semibold text-neutral-900 dark:text-neutral-100">{voterName}</span> さん
    </p>
  );
}

function VideoHeading({ video }: { video: CurrentVideo }) {
  return (
    <div className={card}>
      <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300">投票中の動画</p>
      <p className="mt-1 text-2xl font-bold leading-tight">{video.name}</p>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">{video.nameEn}</p>
    </div>
  );
}

// ---------- 点数を選ぶ部品 ----------
function ScoreGroup({
  criterion,
  title,
  value,
  disabled,
  onSelect,
}: {
  criterion: Criterion;
  title: string;
  value: Score | null;
  disabled: boolean;
  onSelect: (criterion: Criterion, value: Score) => void;
}) {
  return (
    <fieldset className={card} disabled={disabled}>
      <legend className="px-1 text-base font-semibold">{title}</legend>
      <div className="mt-2 grid grid-cols-5 gap-2">
        {SCORES.map((n) => (
          <label key={n} className="relative block">
            <input
              type="radio"
              name={criterion}
              value={n}
              checked={value === n}
              onChange={() => onSelect(criterion, n)}
              className="peer sr-only"
            />
            <span className="flex h-14 cursor-pointer select-none items-center justify-center rounded-xl border-2 border-neutral-300 text-xl font-bold transition-colors peer-checked:border-indigo-600 peer-checked:bg-indigo-600 peer-checked:text-white peer-focus-visible:ring-4 peer-focus-visible:ring-indigo-300 peer-disabled:opacity-60 dark:border-neutral-600 dark:peer-checked:border-indigo-400 dark:peer-checked:bg-indigo-500">
              {n}
            </span>
          </label>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-neutral-600 dark:text-neutral-400">
        <span>1 = {SCALE_LOW_LABEL}</span>
        <span>5 = {SCALE_HIGH_LABEL}</span>
      </div>
      <p className="mt-1 text-sm" aria-live="polite">
        {value === null ? "未選択" : `選択中:${value} 点`}
      </p>
    </fieldset>
  );
}

// ---------- 各画面 ----------
function FormView(props: ScreenViewProps & { screen: Extract<Screen, { kind: "form" }> }) {
  const { screen, draft, sending, canSubmitNow, hint, submitError, onSelect, onSubmit, onCancelEdit } = props;
  return (
    <>
      <Greeting voterName={screen.voterName} />
      <VideoHeading video={screen.video} />
      <p className="text-base font-semibold">
        {screen.mode === "edit" ? "評価を変更できます" : "この動画を評価してください"}
      </p>
      {CRITERIA.map(({ key, title }) => (
        <ScoreGroup key={key} criterion={key} title={title} value={draft[key]} disabled={sending} onSelect={onSelect} />
      ))}
      {submitError ? (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {submitError}
        </p>
      ) : null}
      {/* 「変更をやめる」は投票欄の中に置く(画面の下に固定される部分を、低く保つため) */}
      {screen.mode === "edit" ? (
        <button
          type="button"
          onClick={onCancelEdit}
          disabled={sending}
          className="h-12 w-full rounded-xl border border-neutral-300 text-base font-medium disabled:opacity-60 dark:border-neutral-600"
        >
          変更をやめる
        </button>
      ) : null}
      {/* 画面の下に固定される部分:送信ボタンと案内文だけ */}
      <div
        data-testid="sticky-actions"
        className="sticky bottom-0 -mx-4 mt-2 border-t border-neutral-200 bg-white/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95"
      >
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmitNow}
          className="h-14 w-full rounded-xl bg-indigo-600 text-lg font-bold text-white transition-colors enabled:active:bg-indigo-800 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-500 dark:disabled:bg-neutral-700 dark:disabled:text-neutral-400"
        >
          {sending ? "送信中…" : screen.mode === "edit" ? "変更を送信する" : "送信する"}
        </button>
        {hint ? <p className="mt-2 text-center text-sm text-neutral-600 dark:text-neutral-400">{hint}</p> : null}
      </div>
    </>
  );
}

function VotedView({
  screen,
  justSentTime,
  onStartEdit,
}: Pick<ScreenViewProps, "justSentTime" | "onStartEdit"> & { screen: Extract<Screen, { kind: "voted" }> }) {
  const sentTime = formatSentTime(screen.vote.updatedAt);
  return (
    <>
      <Greeting voterName={screen.voterName} />
      <VideoHeading video={screen.video} />
      {justSentTime !== null ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-2xl border-2 border-emerald-600 bg-emerald-50 p-4 text-emerald-900 dark:border-emerald-500 dark:bg-emerald-950 dark:text-emerald-100"
        >
          <p className="text-2xl font-bold">✓ 送信しました</p>
          <p className="mt-1 text-sm">
            {justSentTime ? `${justSentTime} に送信しました。` : ""}
            締切までは、下のボタンから変更できます。
          </p>
        </div>
      ) : (
        <p className="text-base font-semibold">
          送信済みです{sentTime ? `(${sentTime})` : ""}
        </p>
      )}
      <section className={card} aria-label="あなたの評価">
        <h2 className="text-sm font-medium text-neutral-600 dark:text-neutral-400">あなたの評価</h2>
        <dl className="mt-2 flex flex-col gap-3">
          {CRITERIA.map(({ key, title }) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <dt className="text-base">{title}</dt>
              <dd className="shrink-0 text-3xl font-bold" data-testid={`score-${key}`}>
                {screen.vote[key]}
                <span className="ml-1 text-base font-medium"> 点</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <button
        type="button"
        onClick={onStartEdit}
        className="h-14 w-full rounded-xl border-2 border-indigo-600 text-lg font-bold text-indigo-700 dark:border-indigo-400 dark:text-indigo-300"
      >
        評価を変更する
      </button>
    </>
  );
}

export function ScreenView(props: ScreenViewProps) {
  const { screen, notice, connectionLost, onDismissNotice } = props;

  let body: ReactNode;
  switch (screen.kind) {
    case "loading":
      body = <LoadingCard />;
      break;
    case "invalid-token":
      body = (
        <div className={card} role="alert">
          <p className="text-lg font-bold">本人確認できませんでした</p>
          <p className="mt-2 text-base">{screen.message}</p>
        </div>
      );
      break;
    case "waiting":
      body = (
        <>
          <Greeting voterName={screen.voterName} />
          <div className={card} role="status" aria-live="polite">
            <p className="text-lg font-bold">いま投票中の動画はありません</p>
            <p className="mt-2 text-base">次の動画が始まるまで、このままお待ちください。</p>
          </div>
        </>
      );
      break;
    case "own-video":
      body = (
        <>
          <Greeting voterName={screen.voterName} />
          <VideoHeading video={screen.video} />
          <div className={card} role="status" aria-live="polite">
            <p className="text-2xl font-bold">あなたの動画です</p>
            <p className="mt-2 text-base">自分の動画には投票できません。次の動画が始まるまで、お待ちください。</p>
          </div>
        </>
      );
      break;
    case "form":
      body = <FormView {...props} screen={screen} />;
      break;
    case "voted":
      body = <VotedView screen={screen} justSentTime={props.justSentTime} onStartEdit={props.onStartEdit} />;
      break;
  }

  return (
    <PageFrame>
      {connectionLost ? (
        <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          接続を確認しています…(最後に取得した内容を表示しています)
        </p>
      ) : null}
      {notice ? (
        <div role="status" className="flex items-start justify-between gap-3 rounded-xl bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-950 dark:text-sky-100">
          <p>{notice}</p>
          <button type="button" onClick={onDismissNotice} className="shrink-0 font-semibold underline">
            閉じる
          </button>
        </div>
      ) : null}
      {body}
      {screen.kind !== "invalid-token" ? (
        <p className="pb-2 text-center text-xs text-neutral-500">この画面は自動で更新されます</p>
      ) : null}
    </PageFrame>
  );
}
