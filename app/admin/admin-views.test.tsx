import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AdminStatus } from "../../lib/admin-view";
import { AdminView, type AdminViewProps } from "./admin-views";

// 各画面が描く HTML を調べる(ブラウザは使わない)。
const status = (over: Partial<AdminStatus> = {}): AdminStatus => ({
  videos: [
    { memberId: "K0001", name: "織田信長", nameEn: "Oda Nobunaga", status: "closed", voteCount: 9, eligibleCount: 9, actions: [
      { action: "reopen", enabled: false, reason: "先に「豊臣秀吉」を締め切ってください" },
      { action: "skip", enabled: true, reason: null },
    ] },
    { memberId: "K0002", name: "豊臣秀吉", nameEn: "Toyotomi Hideyoshi", status: "open", voteCount: 3, eligibleCount: 9, actions: [
      { action: "close", enabled: true, reason: null },
      { action: "skip", enabled: true, reason: null },
    ] },
    { memberId: "K0003", name: "徳川家康", nameEn: "Tokugawa Ieyasu", status: "pending", voteCount: 0, eligibleCount: 9, actions: [
      { action: "start", enabled: false, reason: "先に「豊臣秀吉」を締め切ってください" },
      { action: "skip", enabled: true, reason: null },
    ] },
    { memberId: "K0004", name: "伊達政宗", nameEn: "Date Masamune", status: "not_shown", voteCount: 0, eligibleCount: 9, actions: [
      { action: "restore", enabled: true, reason: null },
    ] },
  ],
  open: { memberId: "K0002", name: "豊臣秀吉", nameEn: "Toyotomi Hideyoshi", voteCount: 3, eligibleCount: 9, notVotedNames: ["徳川家康", "伊達政宗"] },
  advance: { willClose: true, closeName: "豊臣秀吉", nextMemberId: "K0003", nextName: "徳川家康", canAdvance: true },
  revealStage: 1,
  revealLabel: "3位を公開中",
  warnings: [{ code: "unfinished-videos", message: "締切前の動画が 2 本残っています。" }],
  rankedCount: 2,
  totals: { members: 10, votes: 12 },
  ...over,
});

function render(over: Partial<AdminViewProps> = {}) {
  const props: AdminViewProps = {
    phase: "dashboard",
    login: { password: "", submitting: false, error: null, locked: null, notice: null },
    status: status(),
    busy: false,
    feedback: null,
    connectionLost: false,
    resetDialog: { open: false, typed: "", submitting: false, error: null },
    showNotVotedNames: false, // 初期値は非表示
    onToggleNotVotedNames: vi.fn(),
    onPasswordChange: vi.fn(),
    onLogin: vi.fn(),
    onLogout: vi.fn(),
    onVideoAction: vi.fn(),
    onAdvance: vi.fn(),
    onReveal: vi.fn(),
    onDismissFeedback: vi.fn(),
    onOpenReset: vi.fn(),
    onCancelReset: vi.fn(),
    onResetTyped: vi.fn(),
    onConfirmReset: vi.fn(),
    ...over,
  };
  return renderToStaticMarkup(<AdminView {...props} />);
}

const count = (html: string, needle: string | RegExp) =>
  typeof needle === "string" ? html.split(needle).length - 1 : (html.match(needle) ?? []).length;
const buttonByTestId = (html: string, id: string) => new RegExp(`<button[^>]*data-testid="${id}"[^>]*>`).exec(html)?.[0] ?? "";
const isDisabled = (html: string, id: string) => /disabled=""/.test(buttonByTestId(html, id));

describe("確認中・ログイン", () => {
  it("確認中:『確認しています…』だけを出す(ログアウトボタンなどは出さない)", () => {
    const html = render({ phase: "checking", status: null });
    expect(html).toContain("確認しています…");
    expect(html).not.toContain("ログアウト");
    expect(html).not.toContain("動画の一覧");
  });

  it("ログイン:パスワード欄(type=password)があり、空のままでは『ログイン』を押せない", () => {
    const html = render({ phase: "login", status: null });
    expect(html).toContain("管理者ログイン");
    expect(html).toMatch(/<input[^>]*type="password"/);
    expect(html).toMatch(/autocomplete="current-password"/i);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*type="submit"|<button[^>]*type="submit"[^>]*disabled=""/);
  });

  it("パスワードを入力すると『ログイン』を押せる", () => {
    const html = render({ phase: "login", status: null, login: { password: "x", submitting: false, error: null, locked: null, notice: null } });
    expect(html).not.toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });

  it("確認中・失敗が続いて止められているとき:入力欄とボタンを使えなくし、残り時間つきの案内を出す", () => {
    const locked = "ログインの失敗が続きました。 残り時間:約9分";
    const html = render({ phase: "login", status: null, login: { password: "x", submitting: false, error: null, locked, notice: null } });
    expect(html).toContain(locked);
    expect(html).toMatch(/<input[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    expect(html).toContain('role="alert"');
  });

  it("パスワードが違うときのメッセージを、role=alert で出す", () => {
    const html = render({ phase: "login", status: null, login: { password: "", submitting: false, error: "パスワードが違います。もう一度入力してください。", locked: null, notice: null } });
    expect(html).toContain("パスワードが違います");
    expect(html).toContain('role="alert"');
  });

  it("期限切れなどのお知らせを出す", () => {
    const html = render({ phase: "login", status: null, login: { password: "", submitting: false, error: null, locked: null, notice: "ログインの期限が切れました。" } });
    expect(html).toContain("ログインの期限が切れました。");
  });

  it("送信中は『確認しています…』になり、押せない", () => {
    const html = render({ phase: "login", status: null, login: { password: "x", submitting: true, error: null, locked: null, notice: null } });
    expect(html).toContain("確認しています…");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });

  it("ログイン画面には、動画の一覧もリセットのボタンも出ない(未ログインでは何も見せない)", () => {
    const html = render({ phase: "login", status: status() }); // 万一 status が渡されても、見せない
    expect(html).not.toContain("動画の一覧");
    expect(html).not.toContain("全データのリセット");
    expect(html).not.toContain("ログアウト");
  });
});

describe("管理画面:投票中の動画", () => {
  // 「投票中の動画」の欄(まだ投票していない人の表示を含む部分)だけを取り出す
  const openCard = (html: string) => {
    const start = html.indexOf('aria-label="投票中の動画"');
    const end = html.indexOf('aria-label="動画の一覧"');
    return html.slice(start, end);
  };

  it("名前、投票済み人数、進み具合のバーを出す", () => {
    const html = render();
    expect(html).toContain("投票中の動画");
    expect(html).toMatch(/data-testid="open-progress-text">投票済み 3 \/ 9 人</);
    expect(html).toContain('aria-valuenow="33"');
  });

  it("まだ投票していない人:初期値は非表示。人数だけ出し、名前は画面に描かない", () => {
    const card = openCard(render());
    const line = /data-testid="not-voted">([^<]*)</.exec(card)?.[1] ?? "";
    expect(line).toBe("まだ投票していない人:2 人(名前は非表示)");
    expect(line).not.toContain("徳川家康");
    expect(line).not.toContain("伊達政宗");
    // 「伊達政宗」は、まだ投票していない人にだけ入っている名前。欄のどこにも描かれていない
    expect(card).not.toContain("伊達政宗");
    expect(card).toContain(">名前を表示する<");
  });

  it("まだ投票していない人:表示にすると、名前が出て、ボタンは『名前を隠す』になる", () => {
    const card = openCard(render({ showNotVotedNames: true }));
    expect(card).toContain("まだ投票していない人:徳川家康、伊達政宗");
    expect(card).toContain(">名前を隠す<");
    expect(card).toContain('aria-pressed="true"');
  });

  it("切替のボタンは、押せる(操作の送信中でも、画面の見せ方だけなので押せる)", () => {
    expect(isDisabled(render({ busy: true }), "toggle-not-voted")).toBe(false);
  });

  it("全員が投票済みなら、その旨を出す(切替のボタンは出さない)", () => {
    const html = render({ status: status({ open: { memberId: "K0002", name: "豊臣秀吉", nameEn: "x", voteCount: 9, eligibleCount: 9, notVotedNames: [] } }) });
    expect(html).toContain("全員が投票済みです");
    expect(html).not.toContain("まだ投票していない人");
    expect(html).not.toContain("toggle-not-voted");
  });

  it("投票中の動画が無いときは、その旨と、最初の動画を開始するボタン", () => {
    const html = render({
      status: status({
        open: null,
        advance: { willClose: false, closeName: null, nextMemberId: "K0001", nextName: "織田信長", canAdvance: true },
      }),
    });
    expect(html).toContain("いま投票中の動画はありません");
    expect(html).toContain("最初の動画を開始(織田信長)");
  });

  it("『締め切って次へ』のボタンに、次の動画の名前が出る", () => {
    const html = render();
    expect(html).toContain("締め切って次へ(次:徳川家康)</button>");
    expect(isDisabled(html, "advance-button")).toBe(false);
  });

  it("操作の送信中、または開始できる動画が無いときは、押せない", () => {
    expect(isDisabled(render({ busy: true }), "advance-button")).toBe(true);
    const none = status({ advance: { willClose: false, closeName: null, nextMemberId: null, nextName: null, canAdvance: false } });
    expect(isDisabled(render({ status: none }), "advance-button")).toBe(true);
  });
});

describe("管理画面:動画の一覧", () => {
  it("名簿順に、名前・状態の表示名が並ぶ", () => {
    const html = render();
    // 一覧の行の順序(投票中の動画の欄には、別に名前が出るので、一覧の行だけを見る)
    const order = ["K0001", "K0002", "K0003", "K0004"].map((id) => html.indexOf(`data-testid="video-row-${id}"`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const name of ["織田信長", "豊臣秀吉", "徳川家康", "伊達政宗"]) expect(html).toContain(`>${name}<`);
    for (const label of ["締切", "投票中", "未放映", "放映不可"]) expect(html).toContain(`>${label}<`);
  });

  it("各動画に、状態に応じたボタンが出る(開始・締切・再開・放映できない・元に戻す)", () => {
    const html = render();
    expect(html).toContain('data-testid="action-K0002-close"');
    expect(html).toContain('data-testid="action-K0003-start"');
    expect(html).toContain('data-testid="action-K0001-reopen"');
    expect(html).toContain('data-testid="action-K0004-restore"');
    expect(html).toContain(">放映できない<");
    expect(html).toContain(">元に戻す<");
  });

  it("ほかの動画が投票中のとき、『開始』『再開』は押せず、理由(先に締め切る動画の名前)が出る", () => {
    const html = render();
    expect(isDisabled(html, "action-K0003-start")).toBe(true);
    expect(isDisabled(html, "action-K0001-reopen")).toBe(true);
    expect(isDisabled(html, "action-K0002-close")).toBe(false);
    expect(count(html, "先に「豊臣秀吉」を締め切ってください")).toBe(2);
  });

  it("操作の送信中は、どのボタンも押せない", () => {
    const html = render({ busy: true });
    expect(isDisabled(html, "action-K0002-close")).toBe(true);
    expect(isDisabled(html, "action-K0004-restore")).toBe(true);
  });

  it("票数は、投票中・締切の動画に出す(未放映・票なしの動画には出さない)", () => {
    const html = render();
    expect(count(html, "票 9 / 9")).toBe(1);
    expect(count(html, "票 3 / 9")).toBe(1);
    expect(count(html, "票 0 / 9")).toBe(0);
  });
});

describe("管理画面:結果の発表", () => {
  it("いまの段階の表示名と、順位の対象の人数", () => {
    const html = render();
    expect(html).toMatch(/data-testid="reveal-label">3位を公開中</);
    expect(html).toContain("(1 / 3)");
    expect(html).toContain("順位の対象:2 名");
  });

  it("次に進むとき、警告を出す(止めはしない:ボタンは押せる)", () => {
    const html = render();
    expect(html).toContain('data-testid="reveal-warnings"');
    expect(html).toContain("締切前の動画が 2 本残っています。");
    expect(isDisabled(html, "reveal-next")).toBe(false);
    expect(html).toMatch(/data-testid="reveal-next"[^>]*>2位まで発表する</);
  });

  it("警告が無ければ、警告欄は出ない", () => {
    expect(render({ status: status({ warnings: [] }) })).not.toContain("reveal-warnings");
  });

  it("段階0:戻す・非表示は押せない。段階3:進められない(警告も出さない)", () => {
    const zero = render({ status: status({ revealStage: 0, revealLabel: "非表示" }) });
    expect(isDisabled(zero, "reveal-back")).toBe(true);
    expect(isDisabled(zero, "reveal-hide")).toBe(true);
    expect(isDisabled(zero, "reveal-next")).toBe(false);

    const three = render({ status: status({ revealStage: 3, revealLabel: "1位まで公開中" }) });
    expect(isDisabled(three, "reveal-next")).toBe(true);
    expect(three).toContain("すべて発表済みです");
    expect(three).not.toContain("reveal-warnings");
    expect(isDisabled(three, "reveal-back")).toBe(false);
  });

  it("操作の送信中は、発表のボタンも押せない", () => {
    const html = render({ busy: true });
    for (const id of ["reveal-next", "reveal-back", "reveal-hide"]) expect(isDisabled(html, id)).toBe(true);
  });
});

describe("管理画面:危険な操作とリセットの確認ダイアログ", () => {
  it("危険な操作の欄に、現在の投票件数と、リセットを開くボタンがある", () => {
    const html = render();
    expect(html).toContain("危険な操作");
    expect(html).toContain("現在、投票 12 件");
    expect(html).toContain('data-testid="reset-open"');
    expect(isDisabled(html, "reset-open")).toBe(false);
  });

  it("ダイアログは、開くまで出ない", () => {
    expect(render()).not.toContain('role="dialog"');
  });

  it("開くと、何が起きるかの説明(投票の件数つき)と、合言葉の入力欄が出る", () => {
    const html = render({ resetDialog: { open: true, typed: "", submitting: false, error: null } });
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("投票 12 件を、すべて削除します。");
    expect(html).toContain("元に戻せません");
    expect(html).toContain("そのまま使えます");
    expect(html).toContain("「リセット」と入力してください");
    expect(html).toContain('data-testid="reset-input"');
  });

  it("合言葉を入力するまで、『リセットする』は押せない(空・途中・違う言葉)", () => {
    for (const typed of ["", "リセ", "reset", "リセットする"]) {
      const html = render({ resetDialog: { open: true, typed, submitting: false, error: null } });
      expect(isDisabled(html, "reset-confirm")).toBe(true);
    }
  });

  it("『リセット』と入力すると、押せるようになる", () => {
    const html = render({ resetDialog: { open: true, typed: "リセット", submitting: false, error: null } });
    expect(isDisabled(html, "reset-confirm")).toBe(false);
    expect(html).toContain(">リセットする<");
  });

  it("送信中は、押せず(二重実行の防止)、キャンセルも入力もできない", () => {
    const html = render({ resetDialog: { open: true, typed: "リセット", submitting: true, error: null } });
    expect(isDisabled(html, "reset-confirm")).toBe(true);
    expect(isDisabled(html, "reset-cancel")).toBe(true);
    expect(html).toContain("リセット中…");
    expect(html).toMatch(/<input[^>]*data-testid="reset-input"[^>]*disabled=""|<input[^>]*disabled=""[^>]*data-testid="reset-input"/);
  });

  it("失敗したときのメッセージを、ダイアログの中に出す", () => {
    const html = render({ resetDialog: { open: true, typed: "リセット", submitting: false, error: "リセットの途中でエラーが起きました。" } });
    expect(html).toContain("リセットの途中でエラーが起きました。");
  });

  it("キャンセルのボタンがある", () => {
    expect(render({ resetDialog: { open: true, typed: "", submitting: false, error: null } })).toContain('data-testid="reset-cancel"');
  });
});

describe("管理画面:お知らせ・接続・ログアウト", () => {
  it("成功のお知らせは role=status、失敗は role=alert。『閉じる』がある", () => {
    const ok = render({ feedback: { tone: "success", message: "「豊臣秀吉」を締め切りました。" } });
    expect(ok).toMatch(/role="status"[^>]*data-testid="feedback"/);
    expect(ok).toContain("「豊臣秀吉」を締め切りました。");
    expect(ok).toContain("閉じる");
    const ng = render({ feedback: { tone: "error", message: "先に締め切ってください。" } });
    expect(ng).toMatch(/role="alert"[^>]*data-testid="feedback"/);
  });

  it("通信が途切れたら、お知らせを出す(管理画面を表示中は、最後の内容を表示していると伝える)", () => {
    const html = render({ connectionLost: true });
    expect(html).toContain("最後に取得した内容を表示しています");
    expect(html).toContain("動画の一覧");
  });

  it("最初の確認中に通信できないときも、お知らせを出す", () => {
    const html = render({ phase: "checking", status: null, connectionLost: true });
    expect(html).toContain("サーバーにつながっていません");
  });

  it("ログアウトのボタンがある。ログイン中は『自動で更新されます』と案内する", () => {
    const html = render();
    expect(html).toContain('data-testid="logout"');
    expect(html).toContain("この画面は自動で更新されます");
  });

  it("画面のどこにも、パスワードやトークンという言葉の値が出ない(ログイン済みの画面)", () => {
    const html = render();
    expect(html).not.toMatch(/type="password"/);
    expect(html.toLowerCase()).not.toContain("token");
  });
});
