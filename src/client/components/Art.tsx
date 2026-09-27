import { useState, type CSSProperties, type ReactNode } from 'react';
import type { Lot } from '../../shared/types';
import { MATERIALS, PHASE_LABEL } from '../../shared/chemistry/materials';
import { lotComponents } from '../../shared/chemistry/processes';
import { ART_ASSETS, MATERIAL_ART, MIXTURE_LABEL, mixtureArtId } from '../../shared/assets/objectArt';
import { markMissing, objectUrl } from '../lib/assets';
import { Formula } from './common';

/**
 * 모든 화면이 같은 물질 그림을 쓰는 공통 컴포넌트.
 * 그림은 포장·보관 오브젝트일 뿐이고, 이름·화학식·수량·상태는 코드로 쓴다.
 * 그림이 없거나 못 읽으면 상태 모양의 임시 대체와 이름을 보여 준다(검수에서 최종 그림으로 세지 않는다).
 */
function ArtImg({ id, size, onFail }: { id: string; size: number; onFail: () => void }) {
  const s = objectUrl(id, 's');
  const m = objectUrl(id, 'm');
  if (!s) return null;
  return (
    <img
      src={size <= 64 ? s : m ?? s}
      srcSet={m ? `${s} 128w, ${m} 256w` : undefined}
      sizes={`${size}px`}
      width={size}
      height={size}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => { markMissing(id); onFail(); }}
    />
  );
}

const PH_SHAPE: Record<string, string> = { g: 'gas', l: 'liq', aq: 'aq', s: 'solid' };

function Placeholder({ phase, name, size }: { phase: string; name: string; size: number }) {
  return (
    <span className={`mart-ph ph-${PH_SHAPE[phase] ?? 'solid'}`} style={{ width: size, height: size }} data-placeholder="1">
      <span className="mart-ph-shape" aria-hidden />
      {size >= 40 && <span className="mart-ph-name">{name.slice(0, 4)}</span>}
    </span>
  );
}

export interface MaterialArtProps {
  materialId?: string;
  lot?: Lot;
  size?: number;
  /** 같은 그림을 다른 상태와 나눠 쓸 때 붙는 상태 배지 (기본 표시) */
  badge?: boolean;
  /** 모든 물질에 상태 칩(기체·액체·고체·수용액)을 붙인다 */
  showPhase?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export function MaterialArt({ materialId, lot, size = 48, badge = true, showPhase = false, className, style, title }: MaterialArtProps) {
  const [failed, setFailed] = useState(false);
  if (lot && lot.kind === 'mixture') return <MixtureArt lot={lot} size={size} className={className} style={style} />;
  const id = materialId ?? lot?.materialId ?? '';
  const m = MATERIALS[id];
  const spec = MATERIAL_ART[id];
  const name = m?.displayName ?? id;
  const phase = m?.phase ?? 's';
  const label = `${name}${m ? ` (${PHASE_LABEL[phase]})` : ''}`;
  const chip = showPhase ? spec?.badge ?? PHASE_LABEL[phase] : badge ? spec?.badge : undefined;
  return (
    <span className={`mart ${className ?? ''}`} style={{ width: size, height: size, ...style }} role="img" aria-label={label} title={title ?? label}>
      {spec && !failed ? <ArtImg id={spec.assetId} size={size} onFail={() => setFailed(true)} /> : null}
      {(!spec || failed || !objectUrl(spec.assetId, 's')) && <Placeholder phase={phase} name={name} size={size} />}
      {chip && size >= 36 && <span className={`mart-badge ${spec?.badge ? 'variant' : ''}`}>{chip}</span>}
    </span>
  );
}

/** 혼합물: 베이스 그림 + 구성 성분 작은 아이콘. 정확한 이름은 코드로 쓴다. 순물질처럼 위장하지 않는다. */
export function MixtureArt({ lot, size = 48, className, style }: { lot: Lot; size?: number; className?: string; style?: CSSProperties }) {
  const [failed, setFailed] = useState(false);
  const base = mixtureArtId(lot.tags);
  const comps = lotComponents(lot);
  const label = `섞인 것: ${comps.map((c) => MATERIALS[c.materialId]?.displayName ?? c.materialId).join(' + ')}`;
  const small = Math.max(16, Math.round(size * 0.42));
  return (
    <span className={`mart mix ${className ?? ''}`} style={{ width: size, height: size, ...style }} role="img" aria-label={label} title={label}>
      {!failed && objectUrl(base, 's') ? <ArtImg id={base} size={size} onFail={() => setFailed(true)} /> : <Placeholder phase="aq" name="섞인 것" size={size} />}
      {size >= 36 && <span className="mart-badge mixb">{MIXTURE_LABEL[base] ?? '섞인 것'}</span>}
      <span className="mart-comps" aria-hidden>
        {comps.slice(0, 3).map((c) => <MaterialArt key={c.materialId} materialId={c.materialId} size={small} badge={false} />)}
      </span>
    </span>
  );
}

/** 오브젝트·공정 보조물 그림 (지원품 상자, 회수 상자, 촉매 카트리지 등) */
export function ObjectArt({ id, size = 64, variant = 'm', className, alt = '', children }: { id: string; size?: number; variant?: 's' | 'm' | 'l'; className?: string; alt?: string; children?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  const url = objectUrl(id, variant);
  const label = alt || ART_ASSETS.find((a) => a.id === id)?.label || '';
  return (
    <span className={`oart ${className ?? ''}`} style={{ width: size, height: size }} role={alt ? 'img' : undefined} aria-label={alt || undefined}>
      {url && !failed ? <img src={url} width={size} height={size} alt="" loading="lazy" decoding="async" draggable={false} onError={() => { markMissing(id); setFailed(true); }} /> : <span className="mart-ph ph-solid" style={{ width: size, height: size }} data-placeholder="1"><span className="mart-ph-shape" aria-hidden /><span className="mart-ph-name">{label.slice(0, 5)}</span></span>}
      {children}
    </span>
  );
}

/** 그림 + 이름 + 수량(+화학식) 한 줄. 카드·보드·출하대·바구니에서 공통 */
export function MatLine({ id, units, size = 40, note, formula = true, className }: { id: string; units?: number | string; size?: number; note?: ReactNode; formula?: boolean; className?: string }) {
  const m = MATERIALS[id];
  return (
    <span className={`matline ${className ?? ''}`}>
      <MaterialArt materialId={id} size={size} />
      <span className="matline-text">
        <span className="matline-name">{m?.displayName ?? id}{units !== undefined && <b className="matline-qty"> ×{units}</b>}</span>
        {formula && <span className="matline-f"><Formula id={id} /></span>}
        {note && <span className="matline-note">{note}</span>}
      </span>
    </span>
  );
}
