import type { ReactNode } from 'react';
import { imageUrl } from '../lib/assets';
import type { Place } from '../lib/places';

const SCENE_ID: Record<Place, string> = { orders: 'scene-orders-v2', workshop: 'scene-workshop-v2', store: 'scene-store-v2', shipping: 'scene-shipping-v2' };
const NPC_ID: Partial<Record<Place, string>> = { orders: 'npc-scientist-v2', store: 'npc-merchant-v2', shipping: 'npc-receiver-v2' };
const NPC_NAME: Partial<Record<Place, string>> = { orders: '연구소장 하늘', store: '상인 도운', shipping: '물류 담당 서연' };

/**
 * 장소 배경 레이어. 이미지가 없으면 장소마다 다른 CSS 공간(창·선반·카운터·출하대)을 그린다.
 * 배경에는 구매 장비나 납품 제품을 그리지 않는다 — 보유 상태는 코드 레이어가 얹는다.
 */
export function Scene({ place, children }: { place: Place; children: ReactNode }) {
  const url = imageUrl(SCENE_ID[place]);
  return (
    <div className={`scene scene-${place}`} style={url ? { backgroundImage: `url(${url})` } : undefined} data-has-image={url ? '1' : '0'}>
      {!url && <SceneFallback place={place} />}
      <div className="scene-content">{children}</div>
    </div>
  );
}

function SceneFallback({ place }: { place: Place }) {
  // 네 장소가 서로 다르게 보이는 최소 벡터 공간
  if (place === 'orders') return <svg className="scene-fb" viewBox="0 0 160 90" aria-hidden><rect width="160" height="90" fill="#f4eee2" /><rect x="10" y="8" width="26" height="40" rx="13" fill="#d8e9ea" /><rect x="120" y="8" width="26" height="40" rx="13" fill="#d8e9ea" /><rect x="50" y="20" width="60" height="26" rx="2" fill="#e3dac8" /><rect x="40" y="58" width="90" height="14" rx="3" fill="#17494d" /><rect x="36" y="54" width="98" height="6" rx="2" fill="#efe7d6" /></svg>;
  if (place === 'workshop') return <svg className="scene-fb" viewBox="0 0 160 90" aria-hidden><rect width="160" height="90" fill="#f2ece0" /><rect x="90" y="8" width="44" height="34" rx="17" fill="#d8e9ea" /><rect x="8" y="10" width="26" height="60" rx="2" fill="#e3dac8" /><rect x="20" y="52" width="120" height="8" rx="2" fill="#efe7d6" /><rect x="24" y="60" width="112" height="18" rx="3" fill="#17494d" /></svg>;
  if (place === 'store') return <svg className="scene-fb" viewBox="0 0 160 90" aria-hidden><rect width="160" height="90" fill="#f5efe3" /><rect x="40" y="6" width="100" height="40" rx="4" fill="#17494d" /><rect x="46" y="12" width="26" height="30" rx="13" fill="#e3dac8" /><rect x="78" y="12" width="26" height="30" rx="13" fill="#e3dac8" /><rect x="110" y="12" width="24" height="30" rx="12" fill="#e3dac8" /><rect x="30" y="50" width="120" height="8" rx="4" fill="#efe7d6" /><rect x="34" y="58" width="112" height="20" rx="3" fill="#1f6f78" /></svg>;
  return <svg className="scene-fb" viewBox="0 0 160 90" aria-hidden><rect width="160" height="90" fill="#f3ede1" /><rect x="96" y="6" width="56" height="44" fill="#d8e9ea" /><rect x="112" y="24" width="30" height="20" rx="2" fill="#e3dac8" /><rect x="10" y="54" width="120" height="8" rx="2" fill="#efe7d6" /><rect x="14" y="62" width="112" height="18" rx="3" fill="#17494d" /><rect x="20" y="66" width="40" height="10" rx="2" fill="#b87346" /></svg>;
}

/** NPC 레이어: 투명 PNG 또는 벡터 실루엣. 클릭 역할이 없으므로 포커스를 받지 않는다. */
export function Npc({ place, line }: { place: Place; line: string }) {
  const id = NPC_ID[place];
  if (!id) return null;
  const url = imageUrl(id);
  return (
    <div className="npc" aria-hidden>
      <div className="npc-bubble" role="presentation"><b>{NPC_NAME[place]}</b><br />{line}</div>
      {url ? <img src={url} alt="" className="npc-img" draggable={false} /> : <NpcSilhouette place={place} />}
    </div>
  );
}

function NpcSilhouette({ place }: { place: Place }) {
  const coat = place === 'orders' ? '#f5f0e6' : place === 'store' ? '#17494d' : '#1f6f78';
  return <svg className="npc-img" viewBox="0 0 120 200" aria-hidden><circle cx="60" cy="42" r="26" fill="#d9b48f" /><path d="M20 200 V120 q0-34 40-34 q40 0 40 34 V200 Z" fill={coat} /><rect x="44" y="118" width="32" height="22" rx="3" fill="#efe7d6" /></svg>;
}
