import { useEffect, useMemo } from 'react';
import type { ModeId } from '../../shared/types';
import { LocalClient } from '../lib/local';
import { useAppState } from '../lib/store';
import { DEFAULT_ECONOMY } from '../../shared/config/economy';
import { GameScreen } from './GameScreen';

/** 연습 모드: 서버 없이 같은 엔진으로 1인 vs AI 공방. 준비 완료를 누르면 라운드가 마무리된다. */
export function PracticeScreen({ mode, onLeave }: { mode: ModeId; onLeave: () => void }) {
  const client = useMemo(() => new LocalClient(mode, 6), [mode]);
  const { view } = useAppState();
  useEffect(() => { client.refresh(); return () => client.close(); }, [client]);
  if (!view) return null;
  if (!view.game) {
    return (
      <div className="screen title-screen">
        <div className="bg-full bg-fallback-lobby" />
        <div className="bg-content title-panel stack">
          <h2 style={{ color: 'var(--teal)' }}>연습 모드 · {mode === 'classic' ? '클래식' : mode === 'extended' ? '확장' : '산업'} 공방</h2>
          <p className="small">코인 {DEFAULT_ECONOMY.startCoins}으로 시작하고, 라운드마다 공방에 <b>길드 연구지원품</b> 세 묶음이 도착해요(1묶음 반송, 2묶음 받기). 제한시간은 없어요. 의뢰소 → 공방 ↔ 상점 → 출하장을 오가며 할 일을 마치고 <b>준비 완료</b>를 누르면 AI 공방이 행동한 뒤 라운드가 마무리돼요. 목표: 6라운드 안에 주문 하나 이상 배달하기.</p>
          <div className="row"><button className="btn btn-ghost" onClick={onLeave}>돌아가기</button><button className="btn btn-copper btn-lg btn-block" onClick={() => client.send({ type: 'start' })}>시작</button></div>
        </div>
      </div>
    );
  }
  return <GameScreen view={view} client={client} onLeave={onLeave} />;
}
