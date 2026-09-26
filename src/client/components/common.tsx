import { useEffect, useState, type ReactNode } from 'react';
import { imageUrl, markMissing } from '../lib/assets';
import { MATERIALS, PHASE_LABEL, formulaText } from '../../shared/chemistry/materials';
import { subscriptFormula } from '../../shared/chemistry/atoms';
import { useAppState } from '../lib/store';

/** 학생용 단계 이름 */
export const PHASE_KO: Record<string, string> = { plan: '상의 시간', execute: '행동 시간', settle: '마무리', finished: '끝', setup: '준비' };

/** 화학식 (아래첨자 적용). 예: H₂O(g) */
export function Formula({ id, withPhase = true }: { id: string; withPhase?: boolean }) {
  const m = MATERIALS[id];
  if (!m) return <span className="formula">{id}</span>;
  return <span className="formula" aria-label={`${m.displayName} ${m.formula}`}>{formulaText(id, withPhase)}</span>;
}

/** 반응식 문자열을 아래첨자로 표시. 예: 2H₂(g) + O₂(g) → 2H₂O(g) */
export function Equation({ text, className }: { text: string; className?: string }) {
  return <span className={`formula ${className ?? ''}`}>{subscriptFormula(text)}</span>;
}

/** 물질 이름을 먼저, 화학식은 작게. 예: 물(수증기) H₂O */
export function Mat({ id, count, bold = true }: { id: string; count?: number; bold?: boolean }) {
  const m = MATERIALS[id];
  if (!m) return <span>{id}</span>;
  return (
    <span className="mat">
      {bold ? <b>{m.displayName}</b> : m.displayName}
      {count !== undefined && <span className="units"> ×{count}</span>}
      <span className="fsmall"> {formulaText(id, false)}</span>
    </span>
  );
}

export function MaterialName({ id }: { id: string }) {
  const m = MATERIALS[id];
  return <span>{m?.displayName ?? id} <span className="muted small">({m ? PHASE_LABEL[m.phase] : ''})</span></span>;
}

/** 이미지 + 코드 대체. onError 시 fallback 렌더 */
export function AssetImage({ id, alt, className, fallback, style }: { id: string; alt: string; className?: string; fallback: ReactNode; style?: React.CSSProperties }) {
  const [failed, setFailed] = useState(false);
  const url = imageUrl(id);
  if (!url || failed) return <>{fallback}</>;
  return <img src={url} alt={alt} className={className} style={style} loading="lazy" onError={() => { markMissing(id); setFailed(true); }} />;
}

export function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-bg" onClick={onClose} role="presentation">
      <div className="modal fade-in" style={wide ? { width: 'min(920px, 100%)' } : undefined} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head"><h3>{title}</h3><button className="x" onClick={onClose} aria-label="닫기">×</button></div>
        {children}
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts } = useAppState();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.level}`}>{t.text}</div>)}
    </div>
  );
}

export function CoinIcon({ size = 18 }: { size?: number }) {
  return <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="10" fill="#E5A33D" /><circle cx="12" cy="12" r="7" fill="none" stroke="#B87346" strokeWidth="2" /><text x="12" y="16" textAnchor="middle" fontSize="10" fontWeight="800" fill="#7a4f0b">C</text></svg>;
}
export function EnergyIcon({ size = 18 }: { size?: number }) {
  return <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden><path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="#2c8a93" /></svg>;
}
export function ActionIcon({ size = 18 }: { size?: number }) {
  return <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden><rect x="3" y="3" width="18" height="18" rx="5" fill="#B87346" /><path d="M8 12l3 3 5-6" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" /></svg>;
}

/** 재고 토큰 (상태별 모양) */
export function Tokens({ materialId, units }: { materialId: string; units: number }) {
  const ph = MATERIALS[materialId]?.phase ?? 's';
  const cls = ph === 'g' ? 'token gas' : ph === 'l' ? 'token liq' : ph === 'aq' ? 'token aq' : 'token';
  const n = Math.min(units, 12);
  return <div className="token-row" aria-hidden>{Array.from({ length: n }, (_, i) => <span key={i} className={cls} />)}{units > 12 && <span className="small">+{units - 12}</span>}</div>;
}

export function Wordmark({ compact }: { compact?: boolean }) {
  return (
    <div className="wordmark" style={compact ? { flexDirection: 'row', gap: 10, marginBottom: 0 } : undefined}>
      <svg width={compact ? 30 : 56} height={compact ? 30 : 56} viewBox="0 0 64 64" aria-hidden><rect width="64" height="64" rx="14" fill="#17494D" /><path d="M18 40 L32 22 L46 40" fill="none" stroke="#B87346" strokeWidth="4" strokeLinecap="round" /><circle cx="18" cy="40" r="6" fill="#F5F0E6" /><circle cx="32" cy="22" r="6" fill="#E5A33D" /><circle cx="46" cy="40" r="6" fill="#F5F0E6" /></svg>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: compact ? 'flex-start' : 'center' }}>
        <h1 style={compact ? { fontSize: 18 } : undefined}>리액션 길드</h1>
        <span className="en" style={compact ? { fontSize: 10 } : undefined}>REACTION GUILD</span>
      </div>
    </div>
  );
}

export function ConnectionBadge() {
  const { connection, closedReason, pendingCount } = useAppState();
  if (connection === 'open' && pendingCount === 0) return null;
  const text = connection === 'connecting' ? '연결 중…' : connection === 'reconnecting' ? '다시 연결 중…' : connection === 'closed' ? (closedReason ?? '연결 종료') : pendingCount > 0 ? '서버 확인 중…' : '';
  return <div className="conn"><span className={`tag ${connection === 'closed' ? 'tag-danger' : 'tag-amber'}`}>{text}</span></div>;
}
