/** 이미지 URL 과 누락 여부. 파일이 없으면 코드 대체를 사용한다. */
const missing = new Set<string>();
let index: Record<string, boolean> | null = null;

export async function loadAssetIndex(): Promise<void> {
  try {
    const res = await fetch('/assets/images/index.json');
    const data = (await res.json()) as { images: { id: string; status: string }[] };
    index = Object.fromEntries(data.images.map((i) => [i.id, i.status === 'ok']));
  } catch { index = null; }
}

export function imageUrl(id: string): string | null {
  if (missing.has(id)) return null;
  if (index && index[id] === false) return null;
  return `/assets/images/${id}.webp`;
}

export function markMissing(id: string): void {
  missing.add(id);
}
