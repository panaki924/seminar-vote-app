import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getResult, type ResultBody, type ResultRepo } from "./result-api";
import { ResultView } from "../app/result/result-views";
import type { VideoStatus } from "./ranking";

const NAMES: Record<string, [string, string]> = {
  A: ["秀吉", "Hideyoshi"], B: ["家康", "Ieyasu"], C: ["政宗", "Masamune"], D: ["信玄", "Shingen"], E: ["謙信", "Kenshin"],
};
const video = (id: string, status: VideoStatus = "closed") => ({ memberId: id, name: NAMES[id][0], nameEn: NAMES[id][1], status });
// 投票者 X・Y・Z が、A〜E に (tech, impact) をつける
const v = (voter: string, target: string, tech: number, impact: number) => ({ voterId: voter, targetId: target, tech, impact });

function repo(stage: number, votes = DISTINCT, videos = ["A", "B", "C", "D", "E"].map((id) => video(id))): ResultRepo {
  return {
    listVideos: vi.fn(async () => videos),
    listVotes: vi.fn(async () => votes),
    getRevealStage: vi.fn(async () => stage),
  };
}
// 総合点:A=10(1位) B=8(2位) C=6(3位) D=4(4位) E=2(5位)
const DISTINCT = [
  v("X", "A", 5, 5), v("Y", "A", 5, 5),
  v("X", "B", 4, 4), v("Y", "B", 4, 4),
  v("X", "C", 3, 3), v("Y", "C", 3, 3),
  v("X", "D", 2, 2), v("Y", "D", 2, 2),
  v("X", "E", 1, 1), v("Y", "E", 1, 1),
];

const body = async (stage: number, ...rest: [typeof DISTINCT?, ReturnType<typeof video>[]?]) =>
  (await getResult(repo(stage, ...rest))).body as ResultBody;

describe("getResult:未発表の順位は、返事に含めない", () => {
  it("段階0:何も返さない(名前も順位も含まれない)", async () => {
    const r = await getResult(repo(0));
    expect(r.status).toBe(200);
    const text = JSON.stringify(r.body);
    expect(r.body).toMatchObject({ ok: true, stage: 0, places: [] });
    for (const n of ["秀吉", "家康", "政宗", "信玄", "謙信"]) expect(text).not.toContain(n);
  });

  it("段階1:3位だけ。1位・2位・4位・5位の名前は、返事のどこにも含まれない", async () => {
    const b = await body(1);
    expect(b.places.map((p) => p.rank)).toEqual([3]);
    const text = JSON.stringify(b);
    expect(text).toContain("政宗");
    for (const hidden of ["秀吉", "家康", "信玄", "謙信"]) expect(text).not.toContain(hidden);
  });

  it("段階2:3位と2位(3位→2位の順)。1位は含まれない", async () => {
    const b = await body(2);
    expect(b.places.map((p) => p.rank)).toEqual([3, 2]);
    expect(JSON.stringify(b)).not.toContain("秀吉");
  });

  it("段階3:3位→2位→1位の順。4位以下は含まれない", async () => {
    const b = await body(3);
    expect(b.places.map((p) => p.rank)).toEqual([3, 2, 1]);
    expect(b.places.map((p) => p.entries[0].name)).toEqual(["政宗", "家康", "秀吉"]);
    const text = JSON.stringify(b);
    expect(text).not.toContain("信玄");
    expect(text).not.toContain("謙信");
  });

  it("平均点(総合・技術・インパクト)を返す。小数第2位まで", async () => {
    const b = await body(3, [v("X", "A", 5, 4), v("Y", "A", 4, 4), v("Z", "A", 4, 5), v("X", "B", 1, 1), v("X", "C", 1, 1)]);
    const first = b.places.find((p) => p.rank === 1)!.entries[0];
    expect(first).toEqual({ name: "秀吉", nameEn: "Hideyoshi", techAvg: 4.33, impactAvg: 4.33, total: 8.67 });
  });

  it("返事に、投票者・個別の点数・トークンは含まれない", async () => {
    const text = JSON.stringify((await getResult(repo(3))).body);
    expect(text).not.toMatch(/voter|"tech"|"impact"|token|memberId/i);
  });

  it("同点は同順位で、全員を表示する(2位が2人 → 3位は『該当者なし』)", async () => {
    const votes = [v("X", "A", 5, 5), v("X", "B", 4, 4), v("X", "C", 4, 4), v("X", "D", 1, 1)];
    const b = await body(3, votes);
    expect(b.places.find((p) => p.rank === 2)!.entries.map((e) => e.name).sort()).toEqual(["家康", "政宗"].sort());
    expect(b.places.find((p) => p.rank === 3)!.entries).toEqual([]); // 3位は存在しない(1,2,2,4)
  });

  it("段階1で3位が存在しない(同順位)ときは、3位の枠を空で返す。ほかの名前は含めない", async () => {
    const votes = [v("X", "A", 5, 5), v("X", "B", 4, 4), v("X", "C", 4, 4), v("X", "D", 1, 1)];
    const b = await body(1, votes);
    expect(b.places).toEqual([{ rank: 3, entries: [] }]);
    expect(JSON.stringify(b)).not.toContain("信玄");
  });

  it("自己投票・放映不可・投票なしは、順位に入らない", async () => {
    const videos = [video("A"), video("B", "not_shown"), video("C"), video("D")];
    const votes = [v("A", "A", 5, 5), v("X", "A", 1, 1), v("X", "B", 5, 5), v("X", "C", 3, 3)]; // D は投票なし
    const b = await body(3, votes, videos);
    const ranked = b.places.flatMap((p) => p.entries.map((e) => e.name));
    expect(ranked).toContain("秀吉");
    expect(ranked).not.toContain("家康"); // not_shown
    expect(ranked).not.toContain("信玄"); // 投票なし
    expect(b.places.find((p) => p.rank === 1)!.entries[0].name).toBe("政宗"); // 秀吉は自己投票を除くと 1+1=2 点
  });

  it("不正な段階の値は、非表示(0)として扱う", async () => {
    expect(((await getResult(repo(7))).body as ResultBody).places).toEqual([]);
  });

  it("DB のエラーは、中身を見せずに 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const bad: ResultRepo = { ...repo(3), listVotes: vi.fn(async () => { throw new Error("SECRET-DB-DETAIL"); }) };
    const r = await getResult(bad);
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("SECRET-DB-DETAIL");
  });
});

describe("ResultView(見た目)", () => {
  const view = (result: ResultBody | null, error: string | null = null) => renderToStaticMarkup(<ResultView result={result} error={error} />);

  it("読み込み前は『読み込み中…』", () => expect(view(null)).toContain("読み込み中…"));
  it("段階0は『結果発表をお待ちください』だけ", () => {
    const html = view({ ok: true, stage: 0, label: "非表示", places: [] });
    expect(html).toContain("結果発表をお待ちください");
    expect(html).not.toContain("place-");
  });
  it("発表済みの順位だけを、順に描く(同順位は全員。平均点つき)", async () => {
    const b = await body(3, [v("X", "A", 5, 5), v("X", "B", 4, 4), v("X", "C", 4, 4), v("X", "D", 1, 1)]);
    const html = view(b);
    expect(html.indexOf("place-3")).toBeLessThan(html.indexOf("place-2"));
    expect(html.indexOf("place-2")).toBeLessThan(html.indexOf("place-1"));
    expect(html).toContain("家康");
    expect(html).toContain("政宗");
    expect(html).toContain("総合 8.00 点");
    expect(html).toContain("該当者なし(同順位のため3位はいません)");
  });
});
