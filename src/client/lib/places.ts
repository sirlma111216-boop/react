import { useEffect, useState, useSyncExternalStore } from 'react';

/** 4개 장소. 이동은 개인 화면 상태이며 서버 경제 명령이 아니다. */
export type Place = 'orders' | 'workshop' | 'store' | 'shipping';
export const PLACES: { id: Place; label: string; icon: string; blurb: string }[] = [
  { id: 'orders', label: '의뢰소', icon: '📋', blurb: '과학자에게 주문을 받아요' },
  { id: 'workshop', label: '공방', icon: '⚗️', blurb: '재료로 만들고 정리해요' },
  { id: 'store', label: '상점', icon: '🧺', blurb: '재료와 장비를 사요' },
  { id: 'shipping', label: '출하장', icon: '📦', blurb: '완성품을 배달하고 코인을 받아요' },
];
export const isPlace = (x: string | null | undefined): x is Place => !!x && PLACES.some((p) => p.id === x);

export function pathFor(code: string, place: Place): string {
  return `/game/${code}/${place}`;
}
export function placeFromPath(): Place | null {
  const m = location.pathname.match(/^\/game\/[A-Za-z0-9]+\/([a-z]+)\/?$/);
  return m && isPlace(m[1]) ? m[1] : null;
}

/** 방별 마지막 장소·집중 의뢰 기억 (기기 로컬) */
function lsGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string | null): void { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {} }

export function usePlaceRoute(roomCode: string | null): [Place, (p: Place) => void] {
  const [place, setPlaceState] = useState<Place>(() => placeFromPath() ?? (roomCode && isPlace(lsGet(`rg.place.${roomCode}`)) ? (lsGet(`rg.place.${roomCode}`) as Place) : 'orders'));
  useEffect(() => {
    if (!roomCode) return;
    const onPop = () => { const p = placeFromPath(); if (p) setPlaceState(p); };
    window.addEventListener('popstate', onPop);
    if (!placeFromPath()) history.replaceState(null, '', pathFor(roomCode, place));
    return () => window.removeEventListener('popstate', onPop);
  }, [roomCode]);
  const setPlace = (p: Place) => {
    setPlaceState(p);
    if (roomCode) { lsSet(`rg.place.${roomCode}`, p); if (placeFromPath() !== p) history.pushState(null, '', pathFor(roomCode, p)); }
  };
  return [place, setPlace];
}

export function useFocusContract(roomCode: string | null): [string | null, (id: string | null) => void] {
  const key = `rg.focus.${roomCode ?? 'practice'}`;
  const [focus, setFocusState] = useState<string | null>(() => lsGet(key));
  const setFocus = (id: string | null) => { setFocusState(id); lsSet(key, id); };
  return [focus, setFocus];
}

/** HUD 미리보기: 행동 버튼에 hover/focus 하면 예상 변화(40 → 32)를 보여준다. 확정 전 실제 수량을 깎지 않는다. */
export interface Preview { coins?: number; energy?: number; actions?: number; label?: string }
let preview: Preview | null = null;
const listeners = new Set<() => void>();
export const previewStore = {
  set(p: Preview | null) { preview = p; for (const l of listeners) l(); },
  get: () => preview,
};
export function usePreview(): Preview | null {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, previewStore.get, previewStore.get);
}
/** 버튼용 hover/focus 핸들러 */
export function previewProps(p: Preview) {
  return { onMouseEnter: () => previewStore.set(p), onMouseLeave: () => previewStore.set(null), onFocus: () => previewStore.set(p), onBlur: () => previewStore.set(null) };
}
