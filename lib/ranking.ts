// 順位計算(純粋関数)。DB・画面・時刻に依存しない。
// 平均の比較は「合計と件数」の整数どうしで行い、小数の誤差で同点が崩れないようにする。

export type VideoStatus = "pending" | "open" | "closed" | "not_shown";

export type VideoInput = {
  memberId: string;
  status: VideoStatus;
};

export type VoteInput = {
  voterId: string;
  targetId: string;
  tech: number; // 1〜5
  impact: number; // 1〜5
  updatedAt?: string; // ISO形式。同じ(投票者, 対象)が複数あるとき新しい方を採用する
};

export type RankedEntry = {
  memberId: string;
  techAvg: number;
  impactAvg: number;
  total: number; // 技術平均 + インパクト平均(2〜10)
  voteCount: number;
  rank: number; // 標準競技順位(1,2,2,4)
};

export type Place = {
  rank: number;
  entries: RankedEntry[]; // 空なら「該当者なし」
};

type Tally = {
  memberId: string;
  techSum: number;
  impactSum: number;
  count: number;
};

// 再投票の上書き:同じ(投票者, 対象)は新しい1件だけ残す。
function dedupeVotes(votes: VoteInput[]): VoteInput[] {
  const latest = new Map<string, VoteInput>();
  for (const vote of votes) {
    const key = `${vote.voterId}\u0000${vote.targetId}`;
    const current = latest.get(key);
    // 日時が同じ・無いときは、配列の後ろにある方を新しい投票とみなす
    if (!current || (vote.updatedAt ?? "") >= (current.updatedAt ?? "")) {
      latest.set(key, vote);
    }
  }
  return [...latest.values()];
}

// a/an と b/bn の大小を、割り算せずに比べる(正なら a が大きい)。
function compareFraction(a: number, an: number, b: number, bn: number): number {
  return a * bn - b * an;
}

// 並び順:総合点 → インパクト平均 → 技術平均(すべて大きい順)。0 なら完全な同点。
function compareTally(x: Tally, y: Tally): number {
  return (
    compareFraction(y.techSum + y.impactSum, y.count, x.techSum + x.impactSum, x.count) ||
    compareFraction(y.impactSum, y.count, x.impactSum, x.count) ||
    compareFraction(y.techSum, y.count, x.techSum, x.count)
  );
}

export function computeRanking(videos: VideoInput[], votes: VoteInput[]): RankedEntry[] {
  // not_shown は順位の対象外
  const tallies = new Map<string, Tally>();
  for (const video of videos) {
    if (video.status === "not_shown") continue;
    tallies.set(video.memberId, { memberId: video.memberId, techSum: 0, impactSum: 0, count: 0 });
  }

  for (const vote of dedupeVotes(votes)) {
    if (vote.voterId === vote.targetId) continue; // 自己投票は集計から除外
    const tally = tallies.get(vote.targetId);
    if (!tally) continue; // 対象外の動画への票は無視
    tally.techSum += vote.tech;
    tally.impactSum += vote.impact;
    tally.count += 1;
  }

  // 投票が1件もない動画は順位の対象外
  const sorted = [...tallies.values()].filter((t) => t.count > 0).sort(compareTally);

  return sorted.map((tally) => ({
    memberId: tally.memberId,
    techAvg: tally.techSum / tally.count,
    impactAvg: tally.impactSum / tally.count,
    total: (tally.techSum + tally.impactSum) / tally.count,
    voteCount: tally.count,
    // 自分より厳密に上の人数 + 1 = 標準競技順位
    rank: sorted.filter((other) => compareTally(other, tally) < 0).length + 1,
  }));
}

// 発表段階(0〜3)で見せてよい順位だけを返す。
// 0=なし / 1=3位 / 2=2位と3位 / 3=1〜3位。
// 該当者がいない順位は entries が空の Place として返す(画面は「該当者なし」と表示する)。
export function filterByRevealStage(ranking: RankedEntry[], stage: number): Place[] {
  if (!Number.isInteger(stage) || stage < 0 || stage > 3) {
    throw new RangeError(`reveal_stage must be an integer from 0 to 3: ${stage}`);
  }
  const places: Place[] = [];
  for (let rank = 3; rank >= 4 - stage; rank--) {
    places.push({ rank, entries: ranking.filter((entry) => entry.rank === rank) });
  }
  return places;
}
