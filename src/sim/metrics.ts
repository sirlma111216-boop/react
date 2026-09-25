import type { GameOutcome } from './runner';
import { BOT_IDS, type BotId } from './bots';

export function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
export function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}
/** 95% 신뢰구간 (정규 근사) */
export function ci95(xs: number[]): [number, number] {
  const m = mean(xs);
  const h = xs.length ? (1.96 * stddev(xs)) / Math.sqrt(xs.length) : 0;
  return [round2(m - h), round2(m + h)];
}
export function proportionCi(k: number, n: number): [number, number] {
  if (!n) return [0, 0];
  const p = k / n;
  const h = 1.96 * Math.sqrt((p * (1 - p)) / n);
  return [round2(p - h), round2(p + h)];
}
export const round2 = (x: number) => Math.round(x * 100) / 100;

export interface Summary {
  games: number;
  teamsPerGame: number;
  errors: number;
  ledgerFailures: number;
  byBot: Record<string, { n: number; asset: number; assetCi: [number, number]; assetMedian: number; winRate: number; delivered: number; firstDelivery: number; stalledRate: number }>;
  byPosition: Record<string, { n: number; winRate: number; winCi: [number, number]; asset: number }>;
  byBundle: Record<string, { n: number; asset: number; winRate: number }>;
  firstDeliveryMedian: number;
  deliveredMedian: number;
  stalledRate: number;
  dominantTemplate: { templateId: string; share: number } | null;
  plannerVsRandom: number;
  skilledSpreadPct: number;
  objective: number;
  objectiveParts: Record<string, number>;
}

export function summarize(outcomes: GameOutcome[]): Summary {
  const valid = outcomes.filter((o) => o.teams.length);
  const byBot: Record<string, { assets: number[]; wins: number; delivered: number[]; first: number[]; stalled: number; rounds: number }> = {};
  const byPos: Record<string, { n: number; wins: number; assets: number[] }> = {};
  const byBundle: Record<string, { n: number; wins: number; assets: number[] }> = {};
  const templateCount: Record<string, number> = {};
  let templateTotal = 0;
  const firstAll: number[] = [];
  const deliveredAll: number[] = [];
  let stalled = 0;
  let stalledDen = 0;
  for (const o of valid) {
    for (const t of o.teams) {
      const b = (byBot[t.bot] ??= { assets: [], wins: 0, delivered: [], first: [], stalled: 0, rounds: 0 });
      b.assets.push(t.asset); b.delivered.push(t.delivered); if (t.firstDelivery) b.first.push(t.firstDelivery); if (t.rank === 1) b.wins++;
      b.stalled += t.stalledRounds; b.rounds += o.rounds;
      const p = (byPos[String(t.position)] ??= { n: 0, wins: 0, assets: [] });
      p.n++; if (t.rank === 1) p.wins++; p.assets.push(t.asset);
      const bu = (byBundle[t.bundleId] ??= { n: 0, wins: 0, assets: [] });
      bu.n++; if (t.rank === 1) bu.wins++; bu.assets.push(t.asset);
      for (const tid of t.deliveredTemplates) { templateCount[tid] = (templateCount[tid] ?? 0) + 1; templateTotal++; }
      if (t.firstDelivery) firstAll.push(t.firstDelivery); else firstAll.push(o.rounds + 1);
      deliveredAll.push(t.delivered);
      if (t.bot !== 'random') { stalled += t.stalledRounds; stalledDen += o.rounds; }
    }
  }
  const outBot: Summary['byBot'] = {};
  for (const [k, v] of Object.entries(byBot)) outBot[k] = { n: v.assets.length, asset: round2(mean(v.assets)), assetCi: ci95(v.assets), assetMedian: median(v.assets), winRate: round2(v.wins / Math.max(1, v.assets.length)), delivered: round2(mean(v.delivered)), firstDelivery: median(v.first), stalledRate: round2(v.stalled / Math.max(1, v.rounds)) };
  const outPos: Summary['byPosition'] = {};
  for (const [k, v] of Object.entries(byPos)) outPos[k] = { n: v.n, winRate: round2(v.wins / v.n), winCi: proportionCi(v.wins, v.n), asset: round2(mean(v.assets)) };
  const outBundle: Summary['byBundle'] = {};
  for (const [k, v] of Object.entries(byBundle)) outBundle[k] = { n: v.n, asset: round2(mean(v.assets)), winRate: round2(v.wins / v.n) };
  const dom = Object.entries(templateCount).sort((a, b) => b[1] - a[1])[0];
  const skilled = BOT_IDS.filter((b) => b !== 'random' && outBot[b]).map((b) => outBot[b]!.assetMedian);
  const spread = skilled.length ? ((Math.max(...skilled) - Math.min(...skilled)) / Math.max(1, Math.min(...skilled))) * 100 : 0;
  const plannerVsRandom = (outBot['planner']?.asset ?? 0) - (outBot['random']?.asset ?? 0);
  const stalledRate = stalledDen ? stalled / stalledDen : 0;
  const posRates = Object.values(outPos).map((p) => p.winRate);
  const posSpread = posRates.length ? Math.max(...posRates) - Math.min(...posRates) : 0;
  const firstMed = median(firstAll);
  const delMed = median(deliveredAll);
  const parts = {
    fairness: -Math.max(0, posSpread - 0.03) * 400,
    progress: -Math.max(0, stalledRate - 0.1) * 300,
    firstSuccess: -Math.max(0, firstMed - 3) * 8,
    deliveries: -(delMed < 2 ? (2 - delMed) * 15 : delMed > 5 ? (delMed - 5) * 6 : 0),
    diversity: -(dom && dom[1] / Math.max(1, templateTotal) > 0.5 ? (dom[1] / templateTotal - 0.5) * 100 : 0),
    skill: plannerVsRandom > 8 ? 10 : -(8 - plannerVsRandom) * 2,
    spread: -Math.max(0, spread - 20) * 0.8,
  };
  const objective = Object.values(parts).reduce((a, b) => a + b, 0);
  return {
    games: valid.length, teamsPerGame: valid[0]?.teams.length ?? 0, errors: outcomes.reduce((a, o) => a + o.errors.length, 0), ledgerFailures: outcomes.filter((o) => !o.ledgerOk).length,
    byBot: outBot, byPosition: outPos, byBundle: outBundle, firstDeliveryMedian: firstMed, deliveredMedian: delMed, stalledRate: round2(stalledRate),
    dominantTemplate: dom ? { templateId: dom[0], share: round2(dom[1] / Math.max(1, templateTotal)) } : null,
    plannerVsRandom: round2(plannerVsRandom), skilledSpreadPct: round2(spread), objective: round2(objective), objectiveParts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, round2(v)])),
  };
}

export const botLabel = (b: BotId) => b;
