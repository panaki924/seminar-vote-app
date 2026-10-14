import { describe, expect, it } from "vitest";
import {
  computeRanking,
  filterByRevealStage,
  type RankedEntry,
  type VideoInput,
  type VoteInput,
} from "./ranking";

const video = (memberId: string, status: VideoInput["status"] = "closed"): VideoInput => ({
  memberId,
  status,
});

const vote = (
  voterId: string,
  targetId: string,
  tech: number,
  impact: number,
  updatedAt?: string,
): VoteInput => ({ voterId, targetId, tech, impact, updatedAt });

const entry = (memberId: string, rank: number): RankedEntry => ({
  memberId,
  techAvg: 0,
  impactAvg: 0,
  total: 0,
  voteCount: 1,
  rank,
});

describe("computeRanking", () => {
  it("自己投票は集計から除外される", () => {
    const ranking = computeRanking(
      [video("A"), video("B")],
      [vote("A", "A", 5, 5), vote("B", "A", 2, 3), vote("A", "B", 4, 4)],
    );
    const a = ranking.find((e) => e.memberId === "A");
    expect(a).toMatchObject({ techAvg: 2, impactAvg: 3, total: 5, voteCount: 1 });
  });

  it("自己投票しかない動画は順位の対象外になる", () => {
    const ranking = computeRanking([video("A"), video("B")], [vote("A", "A", 5, 5), vote("A", "B", 3, 3)]);
    expect(ranking.map((e) => e.memberId)).toEqual(["B"]);
  });

  it("欠席者がいて票数が違っても、合計ではなく平均で順位が決まる", () => {
    // A は 1 票(5,5)、B は 3 票(4,4)。合計なら B が上だが、平均なら A が上。
    const ranking = computeRanking(
      [video("A"), video("B")],
      [
        vote("C", "A", 5, 5),
        vote("A", "B", 4, 4),
        vote("C", "B", 4, 4),
        vote("D", "B", 4, 4),
      ],
    );
    expect(ranking.map((e) => [e.memberId, e.rank])).toEqual([
      ["A", 1],
      ["B", 2],
    ]);
    expect(ranking[0].total).toBe(10);
    expect(ranking[1].total).toBe(8);
  });

  it("not_shown の動画は票があっても順位から除外され、他の順位に影響しない", () => {
    const ranking = computeRanking(
      [video("A"), video("B", "not_shown"), video("C")],
      [vote("D", "A", 3, 3), vote("D", "B", 5, 5), vote("D", "C", 2, 2)],
    );
    expect(ranking.map((e) => [e.memberId, e.rank])).toEqual([
      ["A", 1],
      ["C", 2],
    ]);
  });

  it("投票が1件もない動画は順位の対象外になる", () => {
    const ranking = computeRanking([video("A"), video("B", "pending")], [vote("C", "A", 3, 3)]);
    expect(ranking.map((e) => e.memberId)).toEqual(["A"]);
  });

  it("総合点が同じなら、インパクト平均が高い方が上になる", () => {
    // どちらも総合点 7。A は技術4・インパクト3、B は技術3・インパクト4。
    const ranking = computeRanking(
      [video("A"), video("B")],
      [vote("C", "A", 4, 3), vote("C", "B", 3, 4)],
    );
    expect(ranking.map((e) => [e.memberId, e.rank])).toEqual([
      ["B", 1],
      ["A", 2],
    ]);
  });

  it("総合点・インパクト平均がすべて同じなら同順位になり、次の順位が飛ぶ(1,2,2,4)", () => {
    const ranking = computeRanking(
      [video("A"), video("B"), video("C"), video("D")],
      [
        vote("E", "A", 5, 5),
        vote("E", "B", 4, 4),
        vote("E", "C", 4, 4),
        vote("E", "D", 1, 1),
      ],
    );
    expect(ranking.map((e) => [e.memberId, e.rank])).toEqual([
      ["A", 1],
      ["B", 2],
      ["C", 2],
      ["D", 4],
    ]);
  });

  it("票数が違っても割り切れない平均が等しければ、小数の誤差に左右されず同順位になる", () => {
    // A: 3票 技術13/3・インパクト9/3、B: 6票 技術26/6・インパクト18/6(実質同じ平均)
    const votesForA = [vote("C", "A", 5, 3), vote("D", "A", 4, 3), vote("E", "A", 4, 3)];
    const votesForB = [
      vote("C", "B", 5, 3),
      vote("D", "B", 4, 3),
      vote("E", "B", 4, 3),
      vote("F", "B", 5, 3),
      vote("G", "B", 4, 3),
      vote("H", "B", 4, 3),
    ];
    const ranking = computeRanking([video("A"), video("B")], [...votesForA, ...votesForB]);
    expect(ranking.map((e) => e.rank)).toEqual([1, 1]);
  });

  it("再投票(同じ投票者・同じ対象)は新しい内容で上書きされる", () => {
    const ranking = computeRanking(
      [video("A")],
      [vote("B", "A", 1, 1, "2026-01-01T10:00:00Z"), vote("B", "A", 5, 4, "2026-01-01T10:05:00Z")],
    );
    expect(ranking[0]).toMatchObject({ techAvg: 5, impactAvg: 4, voteCount: 1 });
  });

  it("再投票は配列の順番に関わらず updatedAt が新しい方が採用される", () => {
    const ranking = computeRanking(
      [video("A")],
      [vote("B", "A", 5, 4, "2026-01-01T10:05:00Z"), vote("B", "A", 1, 1, "2026-01-01T10:00:00Z")],
    );
    expect(ranking[0]).toMatchObject({ techAvg: 5, impactAvg: 4, voteCount: 1 });
  });

  it("updatedAt が無い場合は、後ろにある投票が新しい投票として採用される", () => {
    const ranking = computeRanking([video("A")], [vote("B", "A", 1, 1), vote("B", "A", 3, 2)]);
    expect(ranking[0]).toMatchObject({ techAvg: 3, impactAvg: 2, voteCount: 1 });
  });

  it("投票が1件もなければ空の順位を返す", () => {
    expect(computeRanking([video("A")], [])).toEqual([]);
  });
});

describe("filterByRevealStage", () => {
  const ranking = [entry("A", 1), entry("B", 2), entry("C", 3), entry("D", 4)];

  it("段階0では何も返さない", () => {
    expect(filterByRevealStage(ranking, 0)).toEqual([]);
  });

  it("段階1では3位だけを返す", () => {
    const places = filterByRevealStage(ranking, 1);
    expect(places.map((p) => [p.rank, p.entries.map((e) => e.memberId)])).toEqual([[3, ["C"]]]);
  });

  it("段階2では3位と2位を返す", () => {
    const places = filterByRevealStage(ranking, 2);
    expect(places.map((p) => [p.rank, p.entries.map((e) => e.memberId)])).toEqual([
      [3, ["C"]],
      [2, ["B"]],
    ]);
  });

  it("段階3では3位・2位・1位を返し、4位以下は含まない", () => {
    const places = filterByRevealStage(ranking, 3);
    expect(places.map((p) => [p.rank, p.entries.map((e) => e.memberId)])).toEqual([
      [3, ["C"]],
      [2, ["B"]],
      [1, ["A"]],
    ]);
  });

  it("見せてはいけない順位の情報は、返り値のどこにも含まれない", () => {
    const text = JSON.stringify(filterByRevealStage(ranking, 1));
    expect(text).not.toContain('"A"');
    expect(text).not.toContain('"B"');
    expect(text).not.toContain('"D"');
  });

  it("同順位がいるときは、該当者全員をその順位に入れ、存在しない順位は空にする", () => {
    // 1位A、2位B・C(同順位)、次は4位D → 3位は存在しない
    const tied = [entry("A", 1), entry("B", 2), entry("C", 2), entry("D", 4)];
    expect(filterByRevealStage(tied, 1)).toEqual([{ rank: 3, entries: [] }]);
    const places = filterByRevealStage(tied, 3);
    expect(places.map((p) => [p.rank, p.entries.map((e) => e.memberId)])).toEqual([
      [3, []],
      [2, ["B", "C"]],
      [1, ["A"]],
    ]);
  });

  it("順位の対象が3人未満でも、空の順位として返す", () => {
    const places = filterByRevealStage([entry("A", 1)], 3);
    expect(places.map((p) => [p.rank, p.entries.length])).toEqual([
      [3, 0],
      [2, 0],
      [1, 1],
    ]);
  });

  it("段階が0〜3の整数でなければエラーにする", () => {
    expect(() => filterByRevealStage(ranking, 4)).toThrow(RangeError);
    expect(() => filterByRevealStage(ranking, -1)).toThrow(RangeError);
    expect(() => filterByRevealStage(ranking, 1.5)).toThrow(RangeError);
  });
});
