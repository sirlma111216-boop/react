/** 이미지 URL 과 누락 여부. 파일이 없으면 코드 대체를 사용한다. */
const missing = new Set<string>();
let index: Record<string, boolean> | null = null;

export interface ObjectEntry { id: string; status: string; slice?: { top: number; left: number; right: number; bottom: number }; out?: { width: number; height: number } }
let objects: Record<string, ObjectEntry> | null = null;

export async function loadAssetIndex(): Promise<void> {
  const [img, obj] = await Promise.allSettled([
    fetch('/assets/images/index.json').then((r) => r.json() as Promise<{ images: { id: string; status: string }[] }>),
    fetch('/assets/objects/v3/index.json').then((r) => r.json() as Promise<{ objects: ObjectEntry[] }>),
  ]);
  index = img.status === 'fulfilled' ? Object.fromEntries(img.value.images.map((i) => [i.id, i.status === 'ok'])) : null;
  objects = obj.status === 'fulfilled' ? Object.fromEntries(obj.value.objects.map((o) => [o.id, o])) : null;
}

export function imageUrl(id: string): string | null {
  if (missing.has(id)) return null;
  if (index && index[id] === false) return null;
  return `/assets/images/${id}.webp`;
}

export function markMissing(id: string): void {
  missing.add(id);
}

/**
 * V3 물질·오브젝트 그림. 표시 크기에 맞는 변형만 받는다(1024px 원본은 앱이 읽지 않는다).
 * s = 128px(≤64px 표시), m = 256px(≤128px), l = 512px(오브젝트 큰 표시).
 */
export function objectUrl(id: string, size: 's' | 'm' | 'l' = 's'): string | null {
  if (missing.has(id)) return null;
  const entry = objects?.[id];
  if (objects && (!entry || entry.status !== 'ok')) return null;
  if (id === 'obj-mission-board') return '/assets/objects/v3/obj-mission-board.webp';
  const suffix = size === 's' ? '-s' : size === 'l' && id.startsWith('obj-') ? '-l' : '';
  return `/assets/objects/v3/${id}${suffix}.webp`;
}

export function objectEntry(id: string): ObjectEntry | null {
  return objects?.[id] ?? null;
}

/** 검수 화면용: 인덱스가 ok 로 기록한 오브젝트 id */
export function objectStatus(id: string): 'ok' | 'missing' | 'unknown' {
  if (missing.has(id)) return 'missing';
  if (!objects) return 'unknown';
  return objects[id]?.status === 'ok' ? 'ok' : 'missing';
}
