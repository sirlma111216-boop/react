import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { EconomyConfig, ModeId } from '../shared/types';
import { DEFAULT_ECONOMY, cloneConfig } from '../shared/config/economy';
import { ALL_PRESETS } from '../shared/chemistry/modes';
import { Rng } from '../shared/engine/rng';
import { runGame, type GameOutcome, type GameSpec } from './runner';
import { summarize, type Summary } from './metrics';
import { BOT_IDS } from './bots';

const REPORT_DIR = join(process.cwd(), 'reports', 'balance');
mkdirSync(REPORT_DIR, { recursive: true });
mkdirSync(join(REPORT_DIR, 'runs'), { recursive: true });

const BUNDLES = ['gas', 'carbonate', 'material'];
const LEASES = ['U05', 'U06', 'U07'];

/** paired seeds: 같은 시드에서 정책·자리·시작 묶음을 순환 배치한 6경기 */
function pairedSpecs(seed: string, mode: ModeId, presetId: string, rounds: number, config: EconomyConfig, teamCount = 6): GameSpec[] {
  const specs: GameSpec[] = [];
  // 정책 회전 6 × 묶음 회전 3 = 시드당 18경기: 모든 자리가 모든 (정책, 묶음) 조합을 정확히 한 번씩 본다
  for (let rot = 0; rot < teamCount; rot++) for (let brot = 0; brot < BUNDLES.length; brot++) {
    const teams = [];
    for (let pos = 0; pos < teamCount; pos++) {
      const bot = BOT_IDS[(pos + rot) % BOT_IDS.length]!;
      const bundleId = BUNDLES[(pos + brot) % BUNDLES.length]!;
      const leaseId = mode === 'industrial' ? LEASES[(pos + rot + brot) % LEASES.length] : undefined;
      teams.push({ bot, bundleId, leaseId });
    }
    specs.push({ seed: `${seed}-r${rot}b${brot}`, mode, presetId, rounds, teams, config });
  }
  return specs;
}

function runMany(seedPrefix: string, games: number, config: EconomyConfig, opts: { modes?: ModeId[]; rounds?: number } = {}): GameOutcome[] {
  const out: GameOutcome[] = [];
  const presets = ALL_PRESETS.filter((p) => !opts.modes || opts.modes.includes(p.mode));
  let i = 0;
  while (out.length < games) {
    const preset = presets[i % presets.length]!;
    const specs = pairedSpecs(`${seedPrefix}-${i}`, preset.mode, preset.id, opts.rounds ?? 10, config);
    for (const s of specs) { if (out.length >= games) break; out.push(runGame(s)); }
    i++;
  }
  return out;
}

function printSummary(title: string, s: Summary): void {
  console.log(`\n=== ${title} === 경기 ${s.games} (팀 ${s.teamsPerGame}/경기), 오류 ${s.errors}, 원장 실패 ${s.ledgerFailures}`);
  console.log(`objective ${s.objective}  parts ${JSON.stringify(s.objectiveParts)}`);
  console.log(`첫 납품 중앙값 ${s.firstDeliveryMedian}R, 납품 중앙값 ${s.deliveredMedian}, 막힘 비율 ${s.stalledRate}, 지배 계약 ${s.dominantTemplate?.templateId}=${s.dominantTemplate?.share}, 계획−무작위 ${s.plannerVsRandom}, 숙련 격차 ${s.skilledSpreadPct}%`);
  for (const [b, v] of Object.entries(s.byBot)) console.log(`  ${b.padEnd(10)} n=${v.n} 자산 ${v.asset} [${v.assetCi}] 중앙 ${v.assetMedian} 승률 ${v.winRate} 납품 ${v.delivered} 첫납품 ${v.firstDelivery} 막힘 ${v.stalledRate}`);
  for (const [p, v] of Object.entries(s.byPosition)) console.log(`  자리${p} n=${v.n} 승률 ${v.winRate} [${v.winCi}] 자산 ${v.asset}`);
  for (const [b, v] of Object.entries(s.byBundle)) console.log(`  묶음 ${b.padEnd(10)} n=${v.n} 자산 ${v.asset} 승률 ${v.winRate}`);
}

interface Report { title: string; when: string; seedPrefix: string; games: number; configVersion: string; scienceVersion: string; summary: Summary; config: EconomyConfig; failures: string[]; elapsedMs: number }

function writeReport(name: string, r: Report): void {
  writeFileSync(join(REPORT_DIR, `${name}.json`), JSON.stringify(r, null, 2));
}

/** 조정 가능한 매개변수만 흔든다. 화학 데이터·부분 전환 모델은 제외. */
function mutate(config: EconomyConfig, rng: Rng, step: number): { config: EconomyConfig; changes: string[] } {
  const c = cloneConfig(config);
  const changes: string[] = [];
  const n = 1 + rng.int(3);
  for (let i = 0; i < n; i++) {
    const kind = rng.int(6);
    if (kind === 0) {
      const mats = Object.keys(c.prices);
      const m = rng.pick(mats);
      const d = rng.next() < 0.5 ? -1 : 1;
      const nv = Math.max(1, Math.min(6, c.prices[m]! + d));
      if (nv !== c.prices[m]) { changes.push(`price.${m} ${c.prices[m]}→${nv}`); c.prices[m] = nv; }
    } else if (kind === 1) {
      const cid = rng.pick(Object.keys(c.contractRewards));
      const d = (rng.next() < 0.5 ? -1 : 1) * (2 + rng.int(3)) * step;
      const nv = Math.max(8, c.contractRewards[cid]! + d);
      changes.push(`reward.${cid} ${c.contractRewards[cid]}→${nv}`); c.contractRewards[cid] = nv;
    } else if (kind === 2) {
      const d = (rng.next() < 0.5 ? -2 : 2) * step;
      const nv = Math.max(24, Math.min(60, c.startCoins + d));
      if (nv !== c.startCoins) { changes.push(`startCoins ${c.startCoins}→${nv}`); c.startCoins = nv; }
    } else if (kind === 3) {
      const eid = rng.pick(Object.keys(c.equipmentPrices));
      const d = (rng.next() < 0.5 ? -2 : 2) * step;
      const nv = Math.max(4, Math.min(20, c.equipmentPrices[eid]! + d));
      if (nv !== c.equipmentPrices[eid]) { changes.push(`equip.${eid} ${c.equipmentPrices[eid]}→${nv}`); c.equipmentPrices[eid] = nv; }
    } else if (kind === 4) {
      const bi = rng.int(c.bundles.length);
      const b = c.bundles[bi]!;
      const d = rng.next() < 0.5 ? -1 : 1;
      const nv = Math.max(0, Math.min(6, b.extraCoins + d));
      if (nv !== b.extraCoins) { changes.push(`bundle.${b.id}.extraCoins ${b.extraCoins}→${nv}`); b.extraCoins = nv; }
    } else {
      const d = rng.next() < 0.5 ? -1 : 1;
      const nv = Math.max(4, Math.min(10, c.startEnergy + d));
      if (nv !== c.startEnergy) { changes.push(`startEnergy ${c.startEnergy}→${nv}`); c.startEnergy = nv; }
    }
  }
  return { config: c, changes };
}

function loadFinalConfig(): EconomyConfig | null {
  const p = join(REPORT_DIR, 'final.json');
  if (!existsSync(p)) return null;
  try { return (JSON.parse(readFileSync(p, 'utf8')) as Report).config; } catch { return null; }
}

function collectFailures(outs: GameOutcome[], limit = 20): string[] {
  const f: string[] = [];
  for (const o of outs) for (const e of o.errors) { if (f.length >= limit) return f; f.push(`${o.spec.seed} ${o.spec.mode}/${o.spec.presetId}: ${e.split('\n')[0]}`); }
  return f;
}

const cmd = process.argv[2] ?? 'smoke';
const argNum = (name: string, def: number) => { const i = process.argv.indexOf(name); return i >= 0 ? Number(process.argv[i + 1]) : def; };

if (cmd === 'smoke') {
  const games = argNum('--games', 100);
  const t0 = Date.now();
  const outs = runMany('smoke', games, DEFAULT_ECONOMY);
  const s = summarize(outs);
  printSummary('SMOKE', s);
  const failures = collectFailures(outs);
  for (const f of failures) console.log('  실패:', f);
  const byMode: Record<string, number> = {};
  for (const o of outs) byMode[o.spec.mode] = (byMode[o.spec.mode] ?? 0) + 1;
  console.log('모드별 경기 수:', byMode, `소요 ${Date.now() - t0}ms`);
  writeReport('smoke', { title: 'smoke', when: new Date().toISOString(), seedPrefix: 'smoke', games: outs.length, configVersion: DEFAULT_ECONOMY.version, scienceVersion: 'chem-1.0', summary: s, config: DEFAULT_ECONOMY, failures, elapsedMs: Date.now() - t0 });
  if (s.errors || s.ledgerFailures) process.exit(1);
} else if (cmd === 'balance') {
  const games = argNum('--games', 2000);
  const candGames = argNum('--cand', Math.max(300, Math.floor(games / 4)));
  const loops = argNum('--loops', 10);
  const t0 = Date.now();
  console.log(`기준선 ${games}경기 (학습 시드 train-*) ...`);
  const baseOuts = runMany('train', games, DEFAULT_ECONOMY);
  const base = summarize(baseOuts);
  printSummary('BASELINE', base);
  writeReport('baseline', { title: 'baseline', when: new Date().toISOString(), seedPrefix: 'train', games: baseOuts.length, configVersion: DEFAULT_ECONOMY.version, scienceVersion: 'chem-1.0', summary: base, config: DEFAULT_ECONOMY, failures: collectFailures(baseOuts), elapsedMs: Date.now() - t0 });
  let bestConfig = DEFAULT_ECONOMY;
  let bestScore = base.objective;
  const history: { loop: number; changes: string[]; objective: number; accepted: boolean }[] = [];
  const rng = new Rng('balance-search');
  for (let loop = 1; loop <= loops; loop++) {
    const { config, changes } = mutate(bestConfig, rng, 1);
    if (!changes.length) continue;
    const outs = runMany(`train-c${loop}`, candGames, config);
    const s = summarize(outs);
    const accepted = s.errors === 0 && s.ledgerFailures === 0 && s.objective > bestScore + 0.5;
    history.push({ loop, changes, objective: s.objective, accepted });
    console.log(`후보 ${loop}: ${changes.join(', ')} → objective ${s.objective} (기준 ${bestScore}) ${accepted ? '채택' : '기각'}`);
    writeReport(`candidate-${loop}`, { title: `candidate-${loop}: ${changes.join(', ')}`, when: new Date().toISOString(), seedPrefix: `train-c${loop}`, games: outs.length, configVersion: `${config.version}+c${loop}`, scienceVersion: 'chem-1.0', summary: s, config, failures: collectFailures(outs), elapsedMs: Date.now() - t0 });
    if (accepted) { bestConfig = cloneConfig(config); bestConfig.version = `${DEFAULT_ECONOMY.version}+c${loop}`; bestScore = s.objective; }
  }
  const elapsed = Date.now() - t0;
  writeFileSync(join(REPORT_DIR, 'search-history.json'), JSON.stringify({ baseline: base.objective, history, selectedVersion: bestConfig.version, elapsedMs: elapsed }, null, 2));
  writeReport('selected', { title: 'selected (학습 시드 기준, 검증 전)', when: new Date().toISOString(), seedPrefix: 'train', games, configVersion: bestConfig.version, scienceVersion: 'chem-1.0', summary: base, config: bestConfig, failures: [], elapsedMs: elapsed });
  console.log(`\n선택된 설정: ${bestConfig.version} (objective ${bestScore}), 총 소요 ${Math.round(elapsed / 1000)}s. 검증은 npm run sim:validate 로 실행.`);
} else if (cmd === 'validate') {
  const games = argNum('--games', 2000);
  const t0 = Date.now();
  const selectedPath = join(REPORT_DIR, 'selected.json');
  // 기본은 현재 economy.ts(출시 설정). --selected 를 주면 탐색이 고른 설정을 검증한다.
  const useSelected = process.argv.includes('--selected');
  const config = useSelected && existsSync(selectedPath) ? (JSON.parse(readFileSync(selectedPath, 'utf8')) as Report).config : useSelected ? loadFinalConfig() ?? DEFAULT_ECONOMY : DEFAULT_ECONOMY;
  console.log(`검증 ${games}경기 (검증 시드 valid-*, 설정 ${config.version}) ...`);
  const outs = runMany('valid', games, config);
  const s = summarize(outs);
  printSummary('VALIDATE', s);
  const failures = collectFailures(outs);
  const report: Report = { title: 'final validation', when: new Date().toISOString(), seedPrefix: 'valid', games: outs.length, configVersion: config.version, scienceVersion: 'chem-1.0', summary: s, config, failures, elapsedMs: Date.now() - t0 };
  writeReport('final', report);
  // 라운드 프리셋·팀 규모는 분리 요인으로 별도 측정
  const quick = summarize(runMany('valid-quick', 300, config, { rounds: 6 }));
  const long = summarize(runMany('valid-long', 300, config, { rounds: 12 }));
  const md = renderMarkdown(report, quick, long);
  writeFileSync(join(REPORT_DIR, 'BALANCE_REPORT.md'), md);
  console.log(`보고서: reports/balance/final.json, BALANCE_REPORT.md (소요 ${Date.now() - t0}ms)`);
  if (s.errors || s.ledgerFailures) process.exit(1);
} else if (cmd === 'replay') {
  const file = process.argv[3];
  if (!file) { console.error('사용법: npm run sim:replay -- <replay.json>'); process.exit(2); }
  const spec = JSON.parse(readFileSync(file, 'utf8')) as GameSpec;
  const out = runGame(spec, { verbose: true, keepState: true });
  console.log(JSON.stringify({ teams: out.teams, errors: out.errors, ledgerOk: out.ledgerOk }, null, 2));
  if (out.finalState) writeFileSync(join(REPORT_DIR, 'runs', 'replay-final-state.json'), JSON.stringify(out.finalState, null, 2));
} else {
  console.error('알 수 없는 명령:', cmd);
  process.exit(2);
}

function renderMarkdown(r: Report, quick: Summary, long: Summary): string {
  const s = r.summary;
  const lines: string[] = [];
  lines.push('# 밸런스 보고서 (실제 실행 결과)');
  lines.push('');
  lines.push(`- 생성 시각: ${r.when}`);
  lines.push(`- 경제 설정 버전: ${r.configVersion}, 과학 데이터 버전: ${r.scienceVersion}`);
  lines.push(`- 검증 경기 수: ${r.games} (검증 시드 접두사 \`${r.seedPrefix}-*\`, 학습 시드 \`train-*\` 와 분리), 팀 ${s.teamsPerGame}/경기, 소요 ${Math.round(r.elapsedMs / 1000)}s`);
  lines.push(`- 오류 ${s.errors}건, 원장 불일치 ${s.ledgerFailures}경기`);
  lines.push(`- 정책 봇 6종을 paired seeds 로 자리·시작 묶음을 순환 배치. 모든 봇은 플레이어와 같은 명령 검증을 거친다.`);
  lines.push('');
  lines.push('## 지향 지표 결과');
  lines.push('');
  lines.push('| 지표 | 목표 | 결과 |');
  lines.push('|---|---|---|');
  const posRates = Object.values(s.byPosition).map((p) => p.winRate);
  const posSpread = posRates.length ? Math.max(...posRates) - Math.min(...posRates) : 0;
  lines.push(`| 자리 효과 (승률 최대−최소) | ≤ 3%p | ${(posSpread * 100).toFixed(1)}%p |`);
  lines.push(`| 계획 봇 − 무작위 봇 평균 자산 | 유의미하게 양수 | ${s.plannerVsRandom} |`);
  lines.push(`| 숙련 정책 중앙 자산 격차 | ≈ 20% 이내 | ${s.skilledSpreadPct}% |`);
  lines.push(`| 첫 납품 중앙값 | ≤ 3라운드 | ${s.firstDeliveryMedian} |`);
  lines.push(`| 최종 납품 중앙값 | 2~5 | ${s.deliveredMedian} |`);
  lines.push(`| 막힌 실행 단계 비율 (숙련 봇) | ≤ 10% | ${(s.stalledRate * 100).toFixed(1)}% |`);
  lines.push(`| 지배 계약 점유율 | < 50% | ${s.dominantTemplate ? `${s.dominantTemplate.templateId} ${(s.dominantTemplate.share * 100).toFixed(1)}%` : '-'} |`);
  lines.push(`| 불법 생성·음수 재고·중복 보상 | 0 | ${s.errors + s.ledgerFailures} |`);
  lines.push('');
  lines.push('## 정책별');
  lines.push('');
  lines.push('| 봇 | n | 평균 자산 | 95% CI | 중앙 자산 | 승률 | 평균 납품 | 첫 납품 중앙 | 막힘 |');
  lines.push('|---|---:|---:|---|---:|---:|---:|---:|---:|');
  for (const [b, v] of Object.entries(s.byBot)) lines.push(`| ${b} | ${v.n} | ${v.asset} | [${v.assetCi[0]}, ${v.assetCi[1]}] | ${v.assetMedian} | ${v.winRate} | ${v.delivered} | ${v.firstDelivery} | ${v.stalledRate} |`);
  lines.push('');
  lines.push('## 자리별');
  lines.push('');
  lines.push('| 자리 | n | 승률 | 95% CI | 평균 자산 |');
  lines.push('|---|---:|---:|---|---:|');
  for (const [p, v] of Object.entries(s.byPosition)) lines.push(`| ${p} | ${v.n} | ${v.winRate} | [${v.winCi[0]}, ${v.winCi[1]}] | ${v.asset} |`);
  lines.push('');
  lines.push('## 시작 묶음별');
  lines.push('');
  lines.push('| 묶음 | n | 평균 자산 | 승률 |');
  lines.push('|---|---:|---:|---:|');
  for (const [b, v] of Object.entries(s.byBundle)) lines.push(`| ${b} | ${v.n} | ${v.asset} | ${v.winRate} |`);
  lines.push('');
  lines.push('## 라운드 프리셋 (분리 요인, 각 300경기)');
  lines.push('');
  lines.push(`- 6라운드: 첫 납품 중앙 ${quick.firstDeliveryMedian}, 납품 중앙 ${quick.deliveredMedian}, 막힘 ${quick.stalledRate}, 계획−무작위 ${quick.plannerVsRandom}`);
  lines.push(`- 12라운드: 첫 납품 중앙 ${long.firstDeliveryMedian}, 납품 중앙 ${long.deliveredMedian}, 막힘 ${long.stalledRate}, 계획−무작위 ${long.plannerVsRandom}`);
  lines.push('');
  lines.push('## 해석과 미해결 사항');
  lines.push('');
  lines.push('- 봇 승률이 비슷하다는 것이 사람에게 재미있다는 뜻은 아니다. 인간 플레이테스트는 별도 미검증 항목이다.');
  lines.push('- 봇은 플레이어 정보만 사용하며 서버 상태나 미래 이벤트를 보지 않는다. 최적해 상한(oracle)은 만들지 않았다.');
  lines.push('- 실패 경기 목록: ' + (r.failures.length ? r.failures.join('; ') : '없음'));
  lines.push('- 재실행: `npm run sim:balance` (학습) → `npm run sim:validate` (검증). 설정을 바꾸면 `src/shared/config/economy.ts` 를 수정하고 다시 실행한다.');
  return lines.join('\n');
}
