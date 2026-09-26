import { useEffect, useRef, useState } from 'react';
import type { ClientView } from '../../shared/protocol';
import type { Hint } from './Coach';
import { Emblem } from './Emblem';
import { CoinIcon, EnergyIcon, Wordmark } from './common';
import { PLACES, usePreview, type Place } from '../lib/places';
import { useAppState } from '../lib/store';

/** 값이 바뀌면 250~450ms 동안 짧게 강조 */
function useFlash(value: number): 'up' | 'down' | '' {
  const prev = useRef(value);
  const [flash, setFlash] = useState<'up' | 'down' | ''>('');
  useEffect(() => {
    if (prev.current !== value) {
      setFlash(value > prev.current ? 'up' : 'down');
      prev.current = value;
      const t = setTimeout(() => setFlash(''), 420);
      return () => clearTimeout(t);
    }
  }, [value]);
  return flash;
}

export function ActionTokens({ left, total }: { left: number; total: number }) {
  return <span className="tokens" aria-hidden>{Array.from({ length: total }, (_, i) => <span key={i} className={`atoken ${i < left ? 'on' : ''}`} />)}</span>;
}

export function Hud({ view, place, onPlace, hint, badges, onReady, onHelp, onCodex, onLeave, extra }: {
  view: ClientView; place: Place; onPlace: (p: Place) => void; hint: Hint; badges: Partial<Record<Place, string>>;
  onReady: (on: boolean) => void; onHelp: () => void; onCodex: () => void; onLeave: () => void; extra?: React.ReactNode;
}) {
  const g = view.game!;
  const t = g.myTeam!;
  const me = view.me;
  const preview = usePreview();
  const { connection } = useAppState();
  const coinsFlash = useFlash(t.coins);
  const energyFlash = useFlash(t.energy);
  const actFlash = useFlash(t.actionsLeft);
  const opNick = view.players.find((p) => p.id === t.operatorId)?.nick ?? '—';
  const avail = t.coins - t.bid;
  const [confirmReady, setConfirmReady] = useState(false);

  const readyClick = () => {
    if (t.roundReady) { onReady(false); return; }
    if (t.actionsLeft > 0) { setConfirmReady(true); return; }
    onReady(true);
  };

  return (
    <header className="hud">
      <div className="hud-status">
        <Wordmark compact />
        <span className="hud-team"><Emblem shape={t.emblem} color={t.color} size={16} /> {t.name}</span>
        <span className="hud-round">{g.round}/{g.roundsTotal} 라운드</span>
        <span className={`hud-op ${me.isOperator ? 'me' : ''}`}>차례: {opNick}{me.isOperator ? ' (나)' : ''}</span>
        {view.room.status === 'paused' && <span className="tag tag-danger">선생님이 멈춤</span>}
        {connection !== 'open' && view.room.code !== 'PRACTC' && <span className="tag tag-amber">{connection === 'reconnecting' ? '다시 연결 중' : '연결 중'}</span>}
        <span style={{ flex: 1 }} />
        {extra}
        <button className="btn btn-sm btn-ghost" onClick={onHelp}>도움말</button>
        <button className="btn btn-sm btn-ghost" onClick={onCodex}>도감</button>
        <button className="btn btn-sm btn-ghost" onClick={onLeave}>나가기</button>
      </div>
      <div className="hud-main">
        <div className="hud-res" role="group" aria-label="자원">
          <span className={`res res-coin ${coinsFlash}`} title={t.bid > 0 ? `입찰 예약 ${t.bid}코인은 쓸 수 없어요` : '코인'}>
            <CoinIcon size={20} /> <b>{t.coins}</b> <span className="res-label">코인</span>
            {preview?.coins !== undefined && <span className="res-preview">→ {avail + preview.coins}</span>}
            {t.bid > 0 && <span className="small muted">(쓸 수 있음 {avail})</span>}
          </span>
          <span className={`res res-energy ${energyFlash}`} title="에너지: 만들기와 정리하기에 써요. 라운드마다 2씩 차요.">
            <EnergyIcon size={20} /> <b>{t.energy}</b><span className="res-label">/{g.config.energyCap} 에너지</span>
            {preview?.energy !== undefined && <span className="res-preview">→ {t.energy + preview.energy}</span>}
          </span>
          <span className={`res res-act ${actFlash}`} title="행동: 이번 라운드에 할 수 있는 횟수">
            <ActionTokens left={t.actionsLeft} total={g.config.actionsPerRound} /> <b>남은 행동 {t.actionsLeft}/{g.config.actionsPerRound}</b>
            {preview?.actions !== undefined && <span className="res-preview">→ {t.actionsLeft + preview.actions}</span>}
          </span>
        </div>
        <nav className="place-nav" aria-label="장소">
          {PLACES.map((p) => (
            <button key={p.id} className={`place-btn ${place === p.id ? 'active' : ''}`} aria-current={place === p.id ? 'page' : undefined} onClick={() => onPlace(p.id)} title={p.blurb}>
              <span className="place-ico" aria-hidden>{p.icon}</span><span className="place-label">{p.label}</span>
              {badges[p.id] && <span className="place-badge">{badges[p.id]}</span>}
            </button>
          ))}
        </nav>
        <div className="hud-ready">
          {me.isOperator ? (
            <button className={`btn ${t.roundReady ? 'btn-ghost' : t.actionsLeft === 0 ? 'btn-copper pulse' : 'btn-primary'}`} onClick={readyClick} disabled={view.room.status !== 'playing'}>
              {t.roundReady ? `준비 취소 (${g.readyCount}/${g.teamCount} 준비)` : '준비 완료'}
            </button>
          ) : <span className="muted small">{t.roundReady ? `준비 완료 · ${g.readyCount}/${g.teamCount} 팀 대기 중` : `준비: ${g.readyCount}/${g.teamCount} 팀`}</span>}
        </div>
      </div>
      <div className="hud-focus" role="status" aria-live="polite">
        <span className="coach-step">💡 {hint.step}</span>
        <span className="coach-detail">{hint.detail}</span>
        {hint.place !== place && <button className="btn btn-sm btn-primary" onClick={() => onPlace(hint.place)}>{PLACES.find((p) => p.id === hint.place)!.label}으로 →</button>}
      </div>
      {confirmReady && (
        <div className="modal-bg" onClick={() => setConfirmReady(false)} role="presentation">
          <div className="modal" style={{ width: 'min(420px,100%)' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3 style={{ color: 'var(--teal)' }}>행동이 {t.actionsLeft}번 남았어요</h3>
            <p className="small" style={{ marginTop: 8 }}>준비 완료를 누르면 남은 행동 {t.actionsLeft}번은 버려지고 다른 팀을 기다려요. 다른 팀이 아직 준비되지 않았으면 취소할 수 있어요.</p>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn btn-ghost" onClick={() => setConfirmReady(false)}>더 할게요</button>
              <button className="btn btn-primary" onClick={() => { setConfirmReady(false); onReady(true); }}>준비 완료</button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

export function MobileNav({ place, onPlace, badges }: { place: Place; onPlace: (p: Place) => void; badges: Partial<Record<Place, string>> }) {
  return (
    <nav className="mobile-nav" aria-label="장소 이동">
      {PLACES.map((p) => <button key={p.id} className={place === p.id ? 'active' : ''} onClick={() => onPlace(p.id)}><span aria-hidden>{p.icon}</span> {p.label}{badges[p.id] && <span className="place-badge">{badges[p.id]}</span>}</button>)}
    </nav>
  );
}
