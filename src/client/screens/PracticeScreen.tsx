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
  const [auto, setAuto] = useState(false);
  useEffect(() => { client.refresh(); return () => client.close(); }, [client]);
  if (!view) return null;
  if (!view.game) {
    return (
      <div className="screen title-screen">
        <div className="bg-full bg-fallback-lobby" />
        <div className="bg-content title-panel stack">
          <h2 style={{ color: 'var(--teal)' }}>연습 모드 · {mode === 'classic' ? '클래식' : mode === 'extended' ? '확장' : '산업'} 공방</h2>
          <p className="small">시작 재료를 고르고 시작하세요. 연습에서는 시간이 저절로 흐르지 않고 <b>다음 ▶</b> 버튼으로 진행해요. 보드 위의 💡 안내가 다음 할 일을 알려줘요. 목표: 6라운드 안에 주문 하나 이상 배달하기.</p>
          {DEFAULT_ECONOMY.bundles.map((b) => <button key={b.id} className={`btn ${bundle === b.id ? 'btn-primary' : 'btn-ghost'}`} style={{ justifyContent: 'flex-start' }} onClick={() => { setBundle(b.id); client.send({ type: 'setBundle', bundleId: b.id }); }}><span><b>{b.name}</b> <span className="small">{b.items.map((i) => `${MATERIALS[i.materialId]!.displayName} ${i.units}개`).join(' · ')}</span></span></button>)}
          <div className="row"><button className="btn btn-ghost" onClick={onLeave}>돌아가기</button><button className="btn btn-copper btn-lg btn-block" onClick={() => client.send({ type: 'start' })}>시작</button></div>
        </div>
      </div>
    );
  }
  const controls = view.game.phase !== 'finished' ? (
    <>
      <button className="btn btn-sm btn-copper pulse" onClick={() => client.send({ type: 'extend', seconds: 0 })}>다음 ▶ {view.game.phase === 'plan' ? '행동 시간' : view.game.phase === 'execute' ? '마무리' : '다음 라운드'}</button>
      <button className="btn btn-sm btn-ghost" onClick={() => { const on = !auto; setAuto(on); client.setAuto(on); }}>{auto ? '자동 끄기' : '자동 진행'}</button>
      {auto && (view.room.status === 'paused' ? <button className="btn btn-sm" onClick={() => client.send({ type: 'resume' })}>재개</button> : <button className="btn btn-sm btn-ghost" onClick={() => client.send({ type: 'pause' })}>일시정지</button>)}
    </>
  ) : null;
  return <GameScreen view={view} client={client} onLeave={onLeave} headerExtra={controls} />;
}
