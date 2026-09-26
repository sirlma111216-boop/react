import { useEffect, useMemo, useState } from 'react';
import type { ClientView } from '../../shared/protocol';
import type { GameClient } from '../lib/net';
import type { Lot, TeamCommand, TeamState } from '../../shared/types';
import { REACTIONS } from '../../shared/chemistry/reactions';
import { PROCESSES } from '../../shared/chemistry/processes';
import { EQUIPMENT } from '../../shared/chemistry/equipment';
import { MATERIALS } from '../../shared/chemistry/materials';
import { contractSatisfiable } from '../../shared/engine/commands';
import { useCountdown } from '../lib/useCountdown';
import { store } from '../lib/store';
import { audio } from '../lib/audio';
import { prefGet, prefSet } from '../lib/session';
import { CoinIcon, EnergyIcon, ActionIcon, AssetImage, Wordmark, PHASE_KO } from '../components/common';
import { Emblem } from '../components/Emblem';
import { ReactionCard, ReactionDetail } from '../components/ReactionCard';
import { ContractCard } from '../components/ContractCard';
import { LotChip, LotDetail } from '../components/Inventory';
import { ShopModal, EquipmentModal } from '../components/Shops';
import { Codex } from '../components/Codex';
import { CoachBar, HelpModal } from '../components/Coach';
import { ResultsScreen } from './ResultsScreen';

type MobileTab = 'workshop' | 'orders' | 'team' | 'inventory';

export function GameScreen({ view, client, onLeave, headerExtra }: { view: ClientView; client: GameClient; onLeave: () => void; headerExtra?: React.ReactNode }) {
  const game = view.game!;
  const team = game.myTeam;
  const me = view.me;
  const [tab, setTab] = useState<MobileTab>('workshop');
  const [openReaction, setOpenReaction] = useState<string | null>(null);
  const [openLot, setOpenLot] = useState<string | null>(null);
  const [shop, setShop] = useState(false);
  const [equip, setEquip] = useState(false);
  const [codex, setCodex] = useState(false);
  const [help, setHelp] = useState(() => prefGet('help.seen', '0') !== '1');
  const [bidInput, setBidInput] = useState<number | null>(null);
  const seconds = useCountdown(view.room.phaseEndsAt, view.room.pausedRemaining);
  const manual = view.room.phaseEndsAt === null && view.room.pausedRemaining === null && client.kind === 'local';
  const canAct = !!team && me.isOperator && game.phase === 'execute' && view.room.status === 'playing';
  const canPlan = !!team && me.isOperator && (game.phase === 'plan' || game.phase === 'execute') && view.room.status === 'playing';

  useEffect(() => { audio.bgm(game.round >= game.roundsTotal ? 'bgm-final' : 'bgm-gameplay'); }, [game.round, game.roundsTotal]);
  useEffect(() => { if (seconds === 10 && game.phase === 'execute' && me.isOperator && !manual) audio.sfx('sfx-deadline'); }, [seconds, game.phase, me.isOperator, manual]);

  const send = async (cmd: TeamCommand, okSfx?: string) => {
    const r = await client.send({ type: 'team', cmd });
    if (!r.ok) { store.toast(r.error ?? '지금은 할 수 없어요.', 'error'); audio.sfx('sfx-invalid'); }
    else if (okSfx) audio.sfx(okSfx);
    return r.ok;
  };

  const pinCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of team?.pins ?? []) m[p.target] = (m[p.target] ?? 0) + 1;
    return m;
  }, [team?.pins]);

  if (game.phase === 'finished' && game.results) return <ResultsScreen view={view} onLeave={onLeave} />;

  if (!team) {
    return (
      <div className="screen" style={{ padding: 16 }}>
        <div className="card center"><h2>구경 중</h2><p className="muted">팀에 들어가 있지 않아 공개된 진행만 볼 수 있어요. 선생님이 팀에 넣어 줄 수 있어요.</p>
          <div className="others" style={{ marginTop: 12 }}>{view.teams.map((t) => <div key={t.id} className="other"><Emblem shape={t.emblem} color={t.color} /><span>{t.name}</span><span className="muted small">주문 {t.contractsHeld} · 배달 {t.delivered}</span></div>)}</div>
          <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={onLeave}>나가기</button>
        </div>
      </div>
    );
  }

  const operatorNick = view.players.find((p) => p.id === team.operatorId)?.nick ?? '—';
  const lotById = (id: string | null): Lot | null => (id ? team.lots.find((l) => l.id === id) ?? null : null);
  const reactionRunning = team.processes.filter((p) => p.kind === 'reaction');
  const slotCount = 2 + (team.equipment.some((e) => e.id === 'U01') ? 1 : 0);
  const auction = game.auction;
  const activeCls = (t: MobileTab) => (tab === t ? 'active-tab' : '');

  return (
    <div className="board">
      <header className="board-head">
        <Wordmark compact />
        <span className="round-label">{game.round}/{game.roundsTotal} 라운드</span>
        <span className={`phase-pill phase-${game.phase}`}>{PHASE_KO[game.phase]}{view.room.status === 'paused' ? ' · 멈춤' : ''}</span>
        <span className={`timer ${seconds <= 10 && game.phase === 'execute' && !manual ? 'low' : ''}`} aria-live="off">{manual ? '수동' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}</span>
        <span className="stat" title="코인"><CoinIcon /> {team.coins}{team.bid > 0 && <span className="muted small">(입찰 {team.bid})</span>}</span>
        <span className="stat" title="에너지"><EnergyIcon /> {team.energy}/{game.config.energyCap}</span>
        <span className="stat" title="남은 행동"><ActionIcon /> 행동 {game.phase === 'execute' ? team.actionsLeft : '-'}/{game.config.actionsPerRound}</span>
        <span className={`stat ${me.isOperator && game.phase === 'execute' ? 'pulse' : ''}`} style={{ background: me.isOperator ? 'var(--amber-soft)' : undefined }}>차례: {operatorNick}{me.isOperator ? ' (나)' : ''}</span>
        <span style={{ flex: 1 }} />
        {headerExtra}
        <button className="btn btn-sm btn-copper" onClick={() => setHelp(true)}>도움말</button>
        <button className="btn btn-sm btn-ghost" onClick={() => setCodex(true)}>도감</button>
        <button className="btn btn-sm btn-ghost" onClick={onLeave}>나가기</button>
      </header>
      <CoachBar view={view} isLocal={client.kind === 'local'} onGoTab={(t) => setTab(t)} />

      {/* 좌: 주문·가게 */}
      <aside className={`board-left ${activeCls('orders')}`}>
        {auction && (
          <section className="panel" style={{ borderTop: '3px solid var(--amber)' }}>
            <div className="panel-title">도시 특별 주문 · 몰래 입찰 <span className="tag tag-amber">{auction.resolved ? '공개됨' : `${auction.bidderCount}팀 참여`}</span></div>
            <ContractCard c={auction.contract} team={team} round={game.round} mode="auction" />
            {auction.resolved ? <p className="small" style={{ marginTop: 6 }}>{auction.winnerId ? `${view.teams.find((t) => t.id === auction.winnerId)?.name ?? '?'} 팀이 가져갔어요` : '아무도 가져가지 않았어요'}</p> : (
              <div className="row" style={{ marginTop: 8 }}>
                <input type="range" min={0} max={game.config.auctionMaxBid} value={bidInput ?? auction.myBid} onChange={(e) => setBidInput(Number(e.target.value))} disabled={!canPlan} aria-label="입찰액" style={{ flex: 1 }} />
                <b>{bidInput ?? auction.myBid}코인</b>
                <button className="btn btn-sm btn-copper" disabled={!canPlan || (bidInput ?? auction.myBid) === auction.myBid} onClick={() => send({ type: 'bid', amount: bidInput ?? auction.myBid }, 'sfx-card')}>써내기</button>
              </div>
            )}
            <p className="muted small">0은 안 함. 행동 시간이 끝나면 공개되고, 가장 많이 쓴 팀만 돈을 내요.</p>
          </section>
        )}
        <section className="panel">
          <div className="panel-title">받은 주문 <span className="tag">{team.contracts.length}/{game.config.contractLimit}</span></div>
          <div className="stack">
            {team.contracts.length === 0 && <p className="muted small">아직 받은 주문이 없어요. 아래 "새 주문"에서 받으세요.</p>}
            {team.contracts.map((c) => {
              const sat = contractSatisfiable(team, c);
              return <ContractCard key={c.id} c={c} team={team} round={game.round} mode="held" actions={
                <span className="row">
                  {canAct && sat.ok && <button className="btn btn-sm btn-copper pulse" onClick={() => send({ type: 'deliver', contractId: c.id }, 'sfx-delivery')}>배달하기</button>}
                  {canPlan && game.phase === 'plan' && !c.special && <button className="btn btn-sm btn-ghost" onClick={() => send({ type: 'cancelContract', contractId: c.id })}>취소</button>}
                  {!canAct && sat.ok && <span className="tag tag-teal">배달 준비 끝</span>}
                </span>} />;
            })}
          </div>
        </section>
        <section className="panel">
          <div className="panel-title">새 주문 {game.rewardAdjust && Object.keys(game.rewardAdjust).length > 0 && <span className="tag tag-amber">보상 올라감</span>}</div>
          <div className="stack">
            {team.offers.map((o) => <ContractCard key={o.id} c={o} team={team} round={game.round} mode="offer" actions={canPlan ? <button className="btn btn-sm btn-primary" onClick={() => send({ type: 'takeContract', offerId: o.id }, 'sfx-card')}>받기</button> : <button className="btn btn-sm btn-ghost" onClick={() => send({ type: 'pin', playerId: me.playerId, target: `offer:${o.templateId}`, label: `"${o.title}" 주문 추천` }, 'sfx-ping')}>👍</button>} />)}
          </div>
          <p className="muted small" style={{ marginTop: 6 }}>주문 받기는 행동을 쓰지 않아요. 취소는 상의 시간에만.</p>
        </section>
        <section className="panel">
          <div className="panel-title">가게</div>
          <div className="row">
            <button className="btn btn-block" onClick={() => setShop(true)}>🧺 재료 가게</button>
            <button className="btn btn-block" onClick={() => setEquip(true)}>🔧 장비 가게</button>
          </div>
          {game.events.filter((e) => e.announceRound === game.round || e.applyRound === game.round).map((e) => <p key={e.id} className="small" style={{ marginTop: 6, background: 'var(--amber-soft)', padding: 6, borderRadius: 8 }}>{e.applyRound === game.round ? '이번 라운드' : '다음 라운드 예고'}: {e.label}</p>)}
        </section>
      </aside>

      {/* 중앙: 공방 */}
      <main className={`board-center ${activeCls('workshop')}`}>
        <section className="panel">
          <div className="panel-title">작업 자리 {reactionRunning.length}/{slotCount} <span className="muted small" style={{ textTransform: 'none' }}>만들기 중인 것이 여기 보여요</span></div>
          <div className="slots">
            {Array.from({ length: slotCount }, (_, i) => {
              const p = reactionRunning[i];
              if (!p) return <div key={i} className="slot"><AssetImage id="equipment-reactor" alt="" className="slot-img" style={{ opacity: 0.35 }} fallback={<span />} /><span className="muted small">비어 있음</span></div>;
              const r = REACTIONS[p.defId]!;
              const total = p.completesRound - p.startedRound + 1;
              const done = game.round - p.startedRound + (game.phase === 'settle' ? 1 : 0.5);
              return <div key={i} className="slot busy"><span className="slot-name">{r.name} ×{p.scale}</span><span className="muted small">{p.inputSummary}</span><div className="gauge"><div style={{ width: `${Math.min(100, (done / total) * 100)}%` }} /></div><span className="small">{p.completesRound <= game.round ? '이번 마무리 때 완성' : `${p.completesRound}라운드 마무리 때 완성`}</span></div>;
            })}
          </div>
        </section>
        <section className="panel" style={{ flex: 1 }}>
          <div className="panel-title">만들기 카드 <span className="muted small" style={{ textTransform: 'none' }}>{me.isOperator && game.phase === 'execute' ? '카드를 눌러 만들기' : '카드를 눌러 살펴보고 👍 추천'}</span></div>
          <div className="hand">
            {game.activeReactions.map((rid) => <ReactionCard key={rid} rid={rid} team={team} game={game} pinned={pinCount[`reaction:${rid}`] ?? 0} onOpen={() => setOpenReaction(rid)} />)}
          </div>
        </section>
        <section className="panel">
          <div className="panel-title">우리 장비</div>
          <div className="row">
            <span className="tag tag-teal">작업 자리 {slotCount}개</span><span className="tag tag-teal">가열</span><span className="tag tag-teal">기체 모으기</span>
            {team.equipment.map((e) => <span key={e.id} className="tag tag-copper">{EQUIPMENT[e.id]!.name}{e.leased ? ' (빌림)' : ''}</span>)}
          </div>
        </section>
      </main>

      {/* 우: 팀·다른 팀 */}
      <aside className={`board-right ${activeCls('team')}`}>
        <section className="panel">
          <div className="panel-title"><span><Emblem shape={team.emblem} color={team.color} size={16} /> {team.name}</span></div>
          <div className="members">
            {view.teams.find((t) => t.id === team.id)?.members.map((pid) => {
              const p = view.players.find((x) => x.id === pid);
              if (!p) return null;
              return <div key={pid} className={`member ${team.operatorId === pid ? 'operator' : ''} ${pid === me.playerId ? 'me' : ''}`}><span className={`dot ${p.connected ? '' : 'off'}`} />{p.nick}{team.operatorId === pid && <span className="tag tag-amber">차례</span>}{p.isLeader && <span className="small">★</span>}</div>;
            })}
          </div>
          <div className="divider" />
          <div className="panel-title">다음 사람에게 메모</div>
          <textarea className="input" rows={2} placeholder="예: 다음엔 수증기를 응축해서 배달하면 돼" defaultValue={team.memo} key={team.memo} maxLength={200} onBlur={(e) => { if (e.target.value !== team.memo) send({ type: 'memo', text: e.target.value }); }} />
          <div className="panel-title" style={{ marginTop: 8 }}>팀원 추천</div>
          <div className="pins">
            {team.pins.length === 0 && <p className="muted small">카드를 열어 👍를 누르면 여기에 나와요.</p>}
            {team.pins.slice().reverse().map((p, i) => <div key={i} className="pin"><b>{view.players.find((x) => x.id === p.playerId)?.nick ?? '?'}</b>: {p.label}</div>)}
          </div>
        </section>
        <section className="panel">
          <div className="panel-title">진행 상황</div>
          <ul className="small" style={{ margin: 0, paddingLeft: 16 }}>
            {team.processes.map((p) => <li key={p.id}>{p.kind === 'reaction' ? REACTIONS[p.defId]!.name : PROCESSES[p.defId]!.name} → {p.completesRound}라운드에 완성</li>)}
            {team.contracts.map((c) => { const s = contractSatisfiable(team, c); return <li key={c.id}>{c.title}: {s.ok ? '배달 준비 끝' : `아직 부족 — ${s.missing.join(', ')}`}</li>; })}
            {team.processes.length === 0 && team.contracts.length === 0 && <li className="muted">만드는 중인 것도 받은 주문도 없어요</li>}
          </ul>
        </section>
        <section className="panel">
          <div className="panel-title">다른 팀</div>
          <div className="others">
            {view.teams.filter((t) => t.id !== team.id).map((t) => <div key={t.id} className="other"><Emblem shape={t.emblem} color={t.color} size={20} /><span>{t.name}<div className="muted small">주문 {t.contractsHeld} · 배달 {t.delivered}</div></span><Spark data={t.assetHistory} color={t.color} /></div>)}
          </div>
        </section>
        <section className="panel">
          <div className="panel-title">소식</div>
          <div className="small" style={{ maxHeight: 140, overflow: 'auto' }}>{game.log.slice(-12).reverse().map((l, i) => <div key={i} className="muted">{l.round}R {l.text}</div>)}</div>
        </section>
      </aside>

      {/* 하단: 창고 */}
      <section className={`board-inv ${activeCls('inventory')}`}>
        <div className="panel-title">창고 <span className="muted small" style={{ textTransform: 'none' }}>재료를 눌러 자세히 보거나 정리하기</span></div>
        <div className="lots">
          {team.lots.length === 0 && <p className="muted small">창고가 비었어요. 재료 가게에서 사 오세요.</p>}
          {team.lots.map((l) => <LotChip key={l.id} lot={l} selected={openLot === l.id} onClick={() => setOpenLot(l.id)} />)}
        </div>
      </section>

      <nav className="mobile-nav" aria-label="화면 전환">
        {(['workshop', 'orders', 'inventory', 'team'] as MobileTab[]).map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{{ workshop: '공방', orders: '주문', inventory: '창고', team: '팀' }[t]}</button>)}
      </nav>

      {openReaction && <ReactionDetail rid={openReaction} team={team} game={game} canAct={canAct} onClose={() => setOpenReaction(null)}
        onRun={async (scale) => { if (await send({ type: 'react', reactionId: openReaction, scale }, 'sfx-reaction-start')) setOpenReaction(null); }}
        onPin={() => send({ type: 'pin', playerId: me.playerId, target: `reaction:${openReaction}`, label: `"${REACTIONS[openReaction]!.name}" 추천` }, 'sfx-ping')} />}
      {openLot && lotById(openLot) && <LotDetail lot={lotById(openLot)!} team={team} canAct={canAct} onClose={() => setOpenLot(null)} onProcess={async (pid) => { if (await send({ type: 'process', processId: pid, lotId: openLot }, 'sfx-filter')) setOpenLot(null); }} />}
      {shop && <ShopModal game={game} team={team} canAct={canAct} onClose={() => setShop(false)} onBuy={async (items) => { if (await send({ type: 'procure', items }, 'sfx-supply')) setShop(false); }} onBuyEnergy={async (n) => { if (await send({ type: 'buyEnergy', bundles: n }, 'sfx-supply')) setShop(false); }} />}
      {equip && <EquipmentModal game={game} team={team} canAct={canAct} onClose={() => setEquip(false)} onBuy={async (id) => { if (await send({ type: 'equip', equipmentId: id }, 'sfx-achievement')) setEquip(false); }} />}
      {codex && <Codex activeReactions={game.activeReactions} onClose={() => setCodex(false)} />}
      {help && <HelpModal isLocal={client.kind === 'local'} onClose={() => { setHelp(false); prefSet('help.seen', '1'); }} />}
    </div>
  );
}

export function Spark({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return <span className="muted small">{data[0] ?? '-'}</span>;
  const w = 60, h = 20;
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / Math.max(1, max - min)) * (h - 2) - 1}`).join(' ');
  return <svg className="spark" viewBox={`0 0 ${w} ${h}`} aria-label={`코인 변화 ${data[data.length - 1]}`}><polyline points={pts} fill="none" stroke={color} strokeWidth="2" /></svg>;
}

export function materialName(id: string): string { return MATERIALS[id]?.displayName ?? id; }
export type { TeamState };
