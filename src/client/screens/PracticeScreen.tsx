import { useEffect, useMemo, useState } from 'react';
import type { ModeId } from '../../shared/types';
import { LocalClient } from '../lib/local';
import { useAppState } from '../lib/store';
import { DEFAULT_ECONOMY } from '../../shared/config/economy';
import { MATERIALS } from '../../shared/chemistry/materials';
import { GameScreen } from './GameScreen';

/** 연습 모드: 서버 없이 같은 엔진으로 1인 vs AI 공방. */
export function PracticeScreen({ mode, onLeave }: { mode: ModeId; onLeave: () => void }) {
  const client = useMemo(() => new LocalClient(mode, 6), [mode]);
  const { view } = useAppState();
  const [bundle, setBundle] = useState('gas');
  useEffect(() => () => client.close(), [client]);
  if (!view) return null;
  if (!view.game) {
    return (
      <div className="screen title-screen">
        <div className="bg-full bg-fallback-lobby" />
        <div className="bg-content title-panel stack">
          <h2 style={{ color: 'var(--teal)' }}>연습 모드 · {mode === 'classic' ? '클래식' : mode === 'extended' ? '확장' : '산업'} 공방</h2>
          <p className="small">시작 묶음을 고르고 시작하세요. 각 단계는 자동으로 넘어가고, 헤더의 <b>다음 단계</b>로 바로 넘길 수도 있습니다. 목표: 6라운드 안에 주문 하나 이상 납품.</p>
          {DEFAULT_ECONOMY.bundles.map((b) => <button key={b.id} className={`btn ${bundle === b.id ? 'btn-primary' : 'btn-ghost'}`} style={{ justifyContent: 'flex-start' }} onClick={() => { setBundle(b.id); client.send({ type: 'setBundle', bundleId: b.id }); }}><span><b>{b.name}</b> <span className="small">{b.items.map((i) => `${MATERIALS[i.materialId]!.formula}×${i.units}`).join(' ')}</span></span></button>)}
          <div className="row"><button className="btn btn-ghost" onClick={onLeave}>돌아가기</button><button className="btn btn-copper btn-lg btn-block" onClick={() => client.send({ type: 'start' })}>시작</button></div>
        </div>
      </div>
    );
  }
  return (
    <div style={{ position: 'relative' }}>
      <GameScreen view={view} client={client} onLeave={onLeave} />
      {view.game.phase !== 'finished' && <div style={{ position: 'fixed', top: 62, right: 12, zIndex: 20 }} className="row"><button className="btn btn-sm btn-copper" onClick={() => client.send({ type: 'extend', seconds: 0 })}>다음 단계 ▶</button>{view.room.status === 'paused' ? <button className="btn btn-sm" onClick={() => client.send({ type: 'resume' })}>재개</button> : <button className="btn btn-sm btn-ghost" onClick={() => client.send({ type: 'pause' })}>일시정지</button>}</div>}
    </div>
  );
}
