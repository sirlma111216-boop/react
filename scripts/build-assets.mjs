/**
 * 원본 미디어(assets-source/)를 런타임 WebP 로 변환한다.
 * - 파일이 없는 ID 는 건너뛰고 manifest 의 fallback 으로 동작한다.
 * - 실제 알파 채널·크기를 확인해 manifest 기록과 다르면 경고한다.
 * 사용: node scripts/build-assets.mjs [--src <dir>]
 */
import sharp from 'sharp';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = process.cwd();
const argSrc = process.argv.indexOf('--src');
const srcDir = argSrc >= 0 ? resolve(process.argv[argSrc + 1]) : join(root, 'assets-source', 'images');
const outDir = join(root, 'public', 'assets', 'images');
mkdirSync(outDir, { recursive: true });
const manifest = JSON.parse(readFileSync(join(root, 'public', 'assets', 'manifest.json'), 'utf8'));

const results = [];
for (const img of manifest.images) {
  const candidates = [`${img.id}.png`, `${img.id}.png.png`, `${img.id}.jpg`, `${img.id}.webp`];
  const found = candidates.map((c) => join(srcDir, c)).find((p) => existsSync(p));
  if (!found) { results.push({ id: img.id, status: 'missing' }); continue; }
  const meta = await sharp(found).metadata();
  const wantsAlpha = img.alpha === true;
  if (wantsAlpha && !meta.hasAlpha) console.warn(`경고: ${img.id} 는 투명 배경이어야 하는데 알파 채널이 없습니다.`);
  const maxW = img.usage === 'background' ? 1920 : img.usage === 'texture' ? 1024 : 768;
  const pipeline = sharp(found).resize({ width: Math.min(maxW, meta.width), withoutEnlargement: true });
  const quality = img.usage === 'background' ? 78 : img.usage === 'texture' ? 70 : 82;
  const out = join(outDir, `${img.id}.webp`);
  await pipeline.webp({ quality, alphaQuality: 90, effort: 5 }).toFile(out);
  const size = statSync(out).size;
  const om = await sharp(out).metadata();
  results.push({ id: img.id, status: 'ok', width: om.width, height: om.height, alpha: om.hasAlpha, kb: Math.round(size / 1024) });
}
for (const r of results) console.log(r.status === 'ok' ? `${r.id.padEnd(24)} ${r.width}x${r.height} alpha=${r.alpha} ${r.kb}KB` : `${r.id.padEnd(24)} 없음 → 코드 대체`);
writeFileSync(join(root, 'public', 'assets', 'images', 'index.json'), JSON.stringify({ builtAt: new Date().toISOString(), images: results }, null, 2));
