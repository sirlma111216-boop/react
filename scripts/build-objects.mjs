/**
 * V3 물질·혼합물·공정 보조물·신규 오브젝트 아트(assets-source/v3/*.png)를 게임용 WebP 로 변환한다.
 * - 투명 여백을 걷어 내고 정사각형 캔버스에 긴 변 88% 로 다시 앉힌다(48px 에서도 실루엣이 보이게).
 * - 크기 변형: <id>-s.webp 128px(≤64px 표시용), <id>.webp 256px(≤128px), obj-* 는 <id>-l.webp 512px 도 만든다.
 * - obj-mission-board 는 가로형 그대로 자르고 1000px 폭으로 만든 뒤 border-image 조각 좌표를 index.json 에 적는다.
 * - 1024px 원본은 앱이 절대 읽지 않는다. 원본이 없는 ID 는 index 에 missing 으로 남고 앱은 임시 대체를 그린다.
 * 사용: node scripts/build-objects.mjs [--src <dir>]
 */
import sharp from 'sharp';
import { existsSync, mkdirSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = process.cwd();
const argSrc = process.argv.indexOf('--src');
const srcDir = argSrc >= 0 ? resolve(process.argv[argSrc + 1]) : join(root, 'assets-source', 'v3');
const outDir = join(root, 'public', 'assets', 'objects', 'v3');
mkdirSync(outDir, { recursive: true });

const OCCUPANCY = 0.88;
const results = [];

async function squareVariant(src, id) {
  const meta = await sharp(src).metadata();
  // 알파가 거의 0인 그림자 가장자리는 무시하고 내용 상자를 찾는다
  const { info } = await sharp(src).ensureAlpha().trim({ threshold: 8 }).toBuffer({ resolveWithObject: true });
  const bboxW = info.width;
  const bboxH = info.height;
  const side = Math.round(Math.max(bboxW, bboxH) / OCCUPANCY);
  const trimmed = await sharp(src).ensureAlpha().trim({ threshold: 8 }).png().toBuffer();
  const padded = await sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: trimmed, left: Math.round((side - bboxW) / 2), top: Math.round((side - bboxH) / 2) }])
    .png()
    .toBuffer();
  const sizes = [['-s', 128], ['', 256]];
  if (id.startsWith('obj-')) sizes.push(['-l', 512]);
  const files = [];
  for (const [suffix, px] of sizes) {
    const out = join(outDir, `${id}${suffix}.webp`);
    await sharp(padded).resize(px, px, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 86, alphaQuality: 92, effort: 6 }).toFile(out);
    files.push({ suffix, px, kb: Math.round(statSync(out).size / 102.4) / 10 });
  }
  return { width: meta.width, height: meta.height, alpha: !!meta.hasAlpha, occupancyBefore: Math.round((Math.max(bboxW, bboxH) / Math.max(meta.width, meta.height)) * 100) / 100, files };
}

/** 의뢰 보드: 가로형. 내용 상자로 자른 뒤 1000px 폭, border-image 조각(클립이 모서리 조각 안에 들어가게) 계산 */
async function boardVariant(src, id) {
  const meta = await sharp(src).metadata();
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  const a = (x, y) => data[(y * W + x) * C + 3];
  const midX = Math.floor(W / 2), midY = Math.floor(H / 2);
  let frameTop = 0; for (let y = 0; y < H; y++) if (a(midX, y) > 200) { frameTop = y; break; }
  let frameBottom = H - 1; for (let y = H - 1; y >= 0; y--) if (a(midX, y) > 200) { frameBottom = y; break; }
  let frameLeft = 0; for (let x = 0; x < W; x++) if (a(x, midY) > 200) { frameLeft = x; break; }
  let frameRight = W - 1; for (let x = W - 1; x >= 0; x--) if (a(x, midY) > 200) { frameRight = x; break; }
  // 클립: 프레임 위로 튀어나온 불투명 구간
  const probeY = Math.max(0, frameTop - 12);
  const runs = []; let inRun = false, start = 0;
  for (let x = 0; x < W; x++) { const o = a(x, probeY) > 200; if (o && !inRun) { inRun = true; start = x; } if (!o && inRun) { inRun = false; runs.push([start, x]); } }
  let clipTop = frameTop; for (let y = 0; y < frameTop; y++) { let hit = false; for (let x = 0; x < W; x++) if (a(x, y) > 200) { hit = true; break; } if (hit) { clipTop = y; break; } }
  // 클립 아래 끝: 첫 클립 가운데 열에서 프레임 안쪽으로 내려가며 종이색(밝은 아이보리)이 나오는 곳
  const px = (x, y) => [data[(y * W + x) * C], data[(y * W + x) * C + 1], data[(y * W + x) * C + 2]];
  const clipMid = runs.length ? Math.floor((runs[0][0] + runs[0][1]) / 2) : midX;
  let clipBottom = frameTop + 60;
  for (let y = frameTop + 10; y < H / 2; y++) { const [r, g, b] = px(clipMid, y); if (r > 220 && g > 210 && b > 195) { clipBottom = y; break; } }
  const margin = 10;
  const crop = { left: Math.max(0, frameLeft - margin), top: Math.max(0, clipTop - margin), right: Math.min(W, frameRight + margin + 1), bottom: Math.min(H, frameBottom + margin + 14) };
  const cw = crop.right - crop.left, ch = crop.bottom - crop.top;
  const scale = 1000 / cw;
  const out = join(outDir, `${id}.webp`);
  await sharp(src).extract({ left: crop.left, top: crop.top, width: cw, height: ch }).resize(1000).webp({ quality: 86, alphaQuality: 92, effort: 6 }).toFile(out);
  const lastClipEnd = runs.length ? runs[0][1] : frameLeft + 120;
  const firstRightClipStart = runs.length > 1 ? runs[runs.length - 1][0] : frameRight - 120;
  const slice = {
    top: Math.round((clipBottom + 16 - crop.top) * scale),
    left: Math.round((lastClipEnd + 18 - crop.left) * scale),
    right: Math.round((crop.right - (firstRightClipStart - 18)) * scale),
    bottom: Math.round((crop.bottom - (frameBottom - 50)) * scale),
  };
  const om = await sharp(out).metadata();
  return { width: meta.width, height: meta.height, alpha: !!meta.hasAlpha, out: { width: om.width, height: om.height }, slice, files: [{ suffix: '', px: om.width, kb: Math.round(statSync(out).size / 102.4) / 10 }] };
}

if (!existsSync(srcDir)) {
  console.warn(`원본 폴더가 없습니다: ${srcDir} — 기존 public/assets/objects/v3 를 그대로 둡니다.`);
  process.exit(0);
}
const pngs = readdirSync(srcDir).filter((f) => /^(mat|aid|mix|obj)-[a-z0-9-]+\.png$/.test(f)).sort();
for (const f of pngs) {
  const id = f.replace(/\.png$/, '');
  const src = join(srcDir, f);
  try {
    const r = id === 'obj-mission-board' ? await boardVariant(src, id) : await squareVariant(src, id);
    results.push({ id, status: 'ok', ...r });
    console.log(`${id.padEnd(30)} ${r.width}x${r.height} alpha=${r.alpha} → ${r.files.map((x) => `${x.px}px ${x.kb}KB`).join(', ')}${r.slice ? ` slice=${JSON.stringify(r.slice)}` : ''}`);
  } catch (e) {
    results.push({ id, status: 'error', error: String(e) });
    console.error(`${id} 변환 실패: ${e}`);
  }
}
writeFileSync(join(outDir, 'index.json'), JSON.stringify({ builtAt: new Date().toISOString(), occupancy: OCCUPANCY, objects: results }, null, 2));
console.log(`변환 ${results.filter((r) => r.status === 'ok').length}/${pngs.length} → public/assets/objects/v3/`);
