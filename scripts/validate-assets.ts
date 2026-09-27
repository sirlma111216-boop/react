/**
 * V3 에셋 검수: npm run assets:validate
 * - 48개 자산의 게임 파일(WebP)이 실제로 있는지, 형식(RIFF/WEBP)·투명 배경·크기·내부 여백을 확인한다.
 * - 코드의 실제 물질 정의(materialId)에서 매핑을 추적해 reports/material-asset-coverage.json 을 쓴다.
 * - 매핑되지 않은 물질이 있으면 reports/ADDITIONAL_ASSET_PROMPTS.md 에 물질별 완성 프롬프트를 쓴다.
 * - reports/asset-contact-sheet.png 에 48/64/96px 축소본을 모아 식별성을 눈으로 확인하게 한다.
 * 빌드 성공과 아트 완료는 별개다: 누락이 하나라도 있으면 종료 코드 1.
 */
import sharp from 'sharp';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ART_ASSETS, MATERIAL_ART, mixtureArtId } from '../src/shared/assets/objectArt';
import { MATERIALS, PHASE_LABEL } from '../src/shared/chemistry/materials';
import { REACTIONS } from '../src/shared/chemistry/reactions';
import { PROCESSES } from '../src/shared/chemistry/processes';
import { CONTRACTS } from '../src/shared/chemistry/contracts';
import { ALL_PRESETS } from '../src/shared/chemistry/modes';
import { SHOP_BY_MODE } from '../src/shared/config/economy';
import { createGame } from '../src/shared/engine/state';
import { supportPools } from '../src/shared/engine/support';
import { computeReachability } from '../src/shared/engine/reachability';

const root = process.cwd();
const dir = join(root, 'public', 'assets', 'objects', 'v3');
const reportDir = join(root, 'reports');
mkdirSync(reportDir, { recursive: true });

interface FileCheck { file: string; ok: boolean; reason?: string; width?: number; height?: number; alpha?: boolean; kb?: number }
const problems: string[] = [];

async function checkFile(file: string, expectSquare: boolean): Promise<FileCheck> {
  const p = join(dir, file);
  if (!existsSync(p)) return { file, ok: false, reason: '파일 없음' };
  const buf = readFileSync(p);
  const magic = buf.subarray(0, 4).toString('ascii') + buf.subarray(8, 12).toString('ascii');
  if (magic !== 'RIFFWEBP') return { file, ok: false, reason: `WebP 가 아님 (${magic})` };
  const m = await sharp(p).metadata();
  if (!m.hasAlpha) return { file, ok: false, reason: '투명 배경(알파) 없음', width: m.width, height: m.height, alpha: false };
  if (expectSquare && m.width !== m.height) return { file, ok: false, reason: `정사각형 아님 ${m.width}x${m.height}` };
  return { file, ok: true, width: m.width, height: m.height, alpha: true, kb: Math.round(buf.length / 102.4) / 10 };
}

/** 내용이 캔버스에서 차지하는 비율 (긴 변 기준). 너무 작으면 48px 에서 알아보기 어렵다 */
async function occupancy(file: string): Promise<number> {
  const p = join(dir, file);
  const meta = await sharp(p).metadata();
  const { info } = await sharp(p).ensureAlpha().trim({ threshold: 8 }).toBuffer({ resolveWithObject: true });
  return Math.round((Math.max(info.width, info.height) / Math.max(meta.width ?? 1, meta.height ?? 1)) * 100) / 100;
}

async function main() {
  // ---------- 1. 파일 검사 ----------
  const assetResults: Record<string, { ok: boolean; files: FileCheck[]; occupancy: number | null }> = {};
  for (const a of ART_ASSETS) {
    const files = a.id === 'obj-mission-board' ? [`${a.id}.webp`] : a.id.startsWith('obj-') ? [`${a.id}-s.webp`, `${a.id}.webp`, `${a.id}-l.webp`] : [`${a.id}-s.webp`, `${a.id}.webp`];
    const checks = await Promise.all(files.map((f) => checkFile(f, a.id !== 'obj-mission-board')));
    const ok = checks.every((c) => c.ok);
    const occ = ok && a.id !== 'obj-mission-board' ? await occupancy(`${a.id}.webp`) : null;
    if (!ok) problems.push(`${a.id}: ${checks.filter((c) => !c.ok).map((c) => `${c.file} ${c.reason}`).join(', ')}`);
    if (occ !== null && occ < 0.6) problems.push(`${a.id}: 내부 여백 과다 (내용 ${Math.round(occ * 100)}%)`);
    assetResults[a.id] = { ok, files: checks, occupancy: occ };
  }

  // ---------- 2. 실제 물질 정의에서 사용 화면 추적 ----------
  const inShop = new Set(Object.values(SHOP_BY_MODE).flat());
  const reactant = new Set<string>();
  const produced = new Set<string>();
  for (const r of Object.values(REACTIONS)) {
    for (const s of r.reactants) for (const a of s.accepts) reactant.add(a);
    for (const o of r.outputs) for (const p of o.products) produced.add(p.materialId);
  }
  // 가공으로 생기는 순물질 (응축·결정·정제)
  for (const m of ['H2O_l', 'NaCl_s', 'ethanol_l', 'NH3_g', 'ethylAcetate_l']) produced.add(m);
  const contractMats = new Set(Object.values(CONTRACTS).flatMap((c) => c.requirements.map((r) => r.materialId)));
  const supportMats = new Set<string>();
  for (const preset of ALL_PRESETS) {
    const g = createGame({ seed: 'coverage', mode: preset.mode, presetId: preset.id, roundsTotal: 10, teams: [{ id: 'T1', name: 't', color: '#000', emblem: 'circle' }] });
    const map = computeReachability(g.activeReactions, g.shopMaterials, g.activeEquipment);
    const pools = supportPools(g, null, map, 99);
    for (const m of [...pools.basic, ...pools.process, ...pools.finished.map((f) => f.materialId)]) supportMats.add(m);
  }
  const coverage = Object.values(MATERIALS).map((m) => {
    const spec = MATERIAL_ART[m.id];
    const screens: string[] = [];
    if (inShop.has(m.id)) screens.push('상점(구입)');
    if (inShop.has(m.id) || supportMats.has(m.id)) screens.push('재료 선반');
    if (reactant.has(m.id) || produced.has(m.id)) screens.push('작업 카드');
    if (produced.has(m.id)) screens.push('완성품 트레이');
    if (contractMats.has(m.id)) screens.push('의뢰소·의뢰 보드·출하장');
    if (supportMats.has(m.id)) screens.push('연구지원품');
    screens.push('재고 매입', '결과 잔여 재고', '도감');
    const asset = spec ? assetResults[spec.assetId] : undefined;
    const exists = !!asset?.ok;
    return {
      materialId: m.id,
      name: m.displayName,
      formula: m.formula,
      state: m.phase,
      stateLabel: PHASE_LABEL[m.phase],
      composition: 'pure',
      usedIn: screens,
      assetId: spec?.assetId ?? null,
      variantBadge: spec?.badge ?? null,
      imageExists: exists,
      missingReason: !spec ? '매핑 없음 → ADDITIONAL_ASSET_PROMPTS.md' : exists ? null : '게임 파일 없음/형식 오류 → 임시 대체 표시',
    };
  });
  // 혼합물은 별도 로트: 베이스 그림 + 성분 아이콘 (새 이미지 파일을 무한히 만들지 않는다)
  const mixtureSources: Record<string, string[]> = {};
  for (const r of Object.values(REACTIONS)) for (const o of r.outputs) if (o.mixture) (mixtureSources[mixtureArtId(o.tags)] ??= []).push(`${r.id}:${o.products.map((p) => p.materialId).join('+')}`);
  mixtureSources['mix-aqueous-mixture'] ??= ['P02 거르기 후 용질이 두 종 이상 남은 여액'];
  const mixtures = Object.entries(mixtureSources).map(([assetId, sources]) => ({ materialId: `mixture:${assetId}`, name: ART_ASSETS.find((a) => a.id === assetId)?.label, composition: 'mixture', usedIn: ['완성품 트레이', '작업 카드(결과)', '출하장 부족 안내'], assetId, variantBadge: '성분 아이콘 합성', sources, imageExists: !!assetResults[assetId]?.ok, missingReason: assetResults[assetId]?.ok ? null : '게임 파일 없음' }));

  const unmapped = coverage.filter((c) => !c.assetId);
  const missing = ART_ASSETS.filter((a) => !assetResults[a.id]?.ok);
  const report = {
    generatedAt: new Date().toISOString(),
    note: '코드의 MATERIALS 정의에서 추출(문자열 검색 아님). 그림은 포장·보관 오브젝트이며 이름·화학식·수량·상태·품질은 코드가 표시한다.',
    summary: { materials: coverage.length, mapped: coverage.length - unmapped.length, unmapped: unmapped.length, assets: ART_ASSETS.length, assetsOk: ART_ASSETS.length - missing.length, assetsMissing: missing.length, problems },
    materials: coverage,
    mixtures,
    assets: ART_ASSETS.map((a) => ({ ...a, ...assetResults[a.id] })),
  };
  writeFileSync(join(reportDir, 'material-asset-coverage.json'), JSON.stringify(report, null, 2));

  // ---------- 3. 추가 물질 프롬프트 ----------
  const lines = ['# 추가 물질 이미지 프롬프트 (자동 생성)', '', `생성: ${report.generatedAt} · \`npm run assets:validate\``, ''];
  if (!unmapped.length) {
    lines.push(`실제 앱 물질 ${coverage.length}종이 모두 기존 48개 자산에 매핑되어 있어 **추가로 만들 그림이 없습니다.**`, '');
    lines.push('매핑 방식: 같은 그림을 다른 상태와 나눠 쓰는 경우(염화나트륨 결정/수용액, 염화칼슘 고체/수용액, 에탄올 발효액/정제, 수산화나트륨·포도당 수용액)는 기본 물질 그림 + 상태 배지로 표시합니다. 물과 수증기, 염산 수용액과 염화수소 기체는 서로 다른 그림입니다. 자세한 표는 `reports/material-asset-coverage.json`.');
  } else {
    for (const u of unmapped) {
      const slug = u.materialId.toLowerCase().replace(/_/g, '-');
      lines.push(`## mat-${slug} — ${u.name}`, '', `- 원본: \`assets-source/v3/mat-${slug}.png\``, `- 게임 파일: \`public/assets/objects/v3/mat-${slug}.webp\``, '- 규격: 1024×1024, 투명 배경', `- 참고 식별: ${u.formula} / ${u.state}. 이 문자를 이미지에 그리지 않음.`, '', '```text');
      lines.push(`Original isolated illustrated inventory icon for REACTION GUILD. Match supplied existing equipment art and new scene backgrounds. Premium warm 2.5D game-object illustration, soft dimensional hand-painted finish, ivory #F5F0E6, deep teal #17494D and restrained copper details. Consistent gentle three-quarter camera and upper-left studio light, full object inside canvas, centered, approximately 75 percent canvas occupancy, simple bold silhouette readable at 48 pixels, fine details restrained. Genuine transparent alpha background, no painted checkerboard, no surrounding scene, only a very subtle contact shadow. No text, letters, numbers, formulas, logos, watermarks, UI frame, emoji, molecular diagram or particle-count diagram. Packaging accent colors identify game items and must not imply colored contents. Do not imitate a named artist or existing franchise. ${u.state === 'g' ? 'A closed opaque gas vessel with a distinct silhouette and copper valve; do not depict colored gas.' : u.state === 'aq' ? 'An opaque ivory solution stock bottle with a distinct cap and collar; no visible liquid color.' : u.state === 'l' ? 'A clear or opaque laboratory liquid bottle with a distinct shape; no beverage or perfume imagery.' : 'A compact opaque dry-reagent container with a small neutral sample dish; no counted crystals.'} Target canvas 1024 by 1024 pixels.`);
      lines.push('```', '');
    }
  }
  writeFileSync(join(reportDir, 'ADDITIONAL_ASSET_PROMPTS.md'), lines.join('\n'));

  // ---------- 4. 48/64/96px 식별성 접촉 시트 ----------
  const ok = ART_ASSETS.filter((a) => assetResults[a.id]?.ok && a.id !== 'obj-mission-board');
  const cellW = 230, cellH = 110, cols = 5;
  const rows = Math.ceil(ok.length / cols);
  const comps: sharp.OverlayOptions[] = [];
  for (let i = 0; i < ok.length; i++) {
    const a = ok[i]!;
    const x = (i % cols) * cellW, y = Math.floor(i / cols) * cellH;
    let dx = 6;
    for (const px of [48, 64, 96]) {
      comps.push({ input: await sharp(join(dir, `${a.id}${px <= 64 ? '-s' : ''}.webp`)).resize(px, px).png().toBuffer(), left: x + dx, top: y + (cellH - px) - 14 });
      dx += px + 8;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cellW}" height="14"><text x="6" y="11" font-size="10" font-family="sans-serif" fill="#1f2a2b">${a.id}</text></svg>`;
    comps.push({ input: Buffer.from(svg), left: x, top: y + cellH - 14 });
  }
  await sharp({ create: { width: cols * cellW, height: rows * cellH, channels: 4, background: '#f5f0e6' } }).composite(comps).png().toFile(join(reportDir, 'asset-contact-sheet.png'));

  console.log(`물질 매핑 ${report.summary.mapped}/${report.summary.materials} · 자산 ${report.summary.assetsOk}/${report.summary.assets} · 누락 ${missing.length} · 추가 프롬프트 ${unmapped.length}`);
  for (const p of problems) console.log('  문제:', p);
  console.log('보고서: reports/material-asset-coverage.json, reports/ADDITIONAL_ASSET_PROMPTS.md, reports/asset-contact-sheet.png');
  if (missing.length || unmapped.length || problems.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
void PROCESSES;
