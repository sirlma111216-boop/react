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
import { CoinIcon, EnergyIcon, ActionIcon, Formula, AssetImage, Wordmark } from '../components/common';
import { Emblem } from '../components/Emblem';
import { ReactionCard, ReactionDetail } from '../components/ReactionCard';
import { ContractCard } from '../components/ContractCard';
import { LotChip, LotDetail } from '../components/Inventory';
import { ShopModal, EquipmentModal } from '../components/Shops';
import { Codex } from '../components/Codex';
import { CoachBar, HelpModal } from '../components/Coach';
import { prefGet, prefSet } from '../lib/session';
import { ResultsScreen } from './ResultsScreen';

type MobileTab = 'workshop' | 'orders' | 'team' | 'inventory';

const PHASE_LABEL = { plan: '계획', execute: '실행', settle: '정산·인계', finished: '종료', setup: '준비' } as const;

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
  const manual = view.room.phaseEndsAt === null && view.room.pausedRemaining === null && client.kind === 'local';
  const [bidInput, setBidInput] = useState<number | null>(null);
  const seconds = useCountdown(view.room.phaseEndsAt, view.room.pausedRemaining);
  const canAct = !!team && me.isOperator && game.phase === 'execute' && view.room.status === 'playing';
  const canPlan = !!team && me.isOperator && (game.phase === 'plan' || game.phase === 'execute') && view.room.status === 'playing';

  useEffect(() => { audio.bgm(game.round >= game.roundsTotal ? 'bgm-final' : 'bgm-gameplay'); }, [game.round, game.roundsTotal]);
  useEffect(() => { if (seconds === 10 && game.phase === 'execute' && me.isOperator) audio.sfx('sfx-deadline'); }, [seconds, game.phase, me.isOperator]);

  const send = async (cmd: TeamCommand, okSfx?: string) => {
    const r = await client.send({ type: 'team', cmd });
    if (!r.ok) { store.toast(r.error ?? '실행할 수 없습니다.', 'error'); audio.sfx('sfx-invalid'); }
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
        <div className="card center"><h2>관전 중</h2><p className="muted">팀에 속해 있지 않아 공개 진행만 볼 수 있습니다. 교사가 팀에 편입할 수 있습니다.</p>
          <div className="others" style={{ marginTop: 12 }}>{view.teams.map((t) => <div key={t.id} className="other"><Emblem shape={t.emblem} color={t.color} /><span>{t.name}</span><span className="muted small">계약 {t.contractsHeld} · 납품 {t.delivered}</span></div>)}</div>
          <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={onLeave}>나가기</button>
        </div>
      </div>
    );
  }

  const operatorNick = view.players.find((p) => p.id === team.operatorId)?.nick ?? '—';
  const lotById = (id: string | null): Lot | null => (id ? team.lots.find((l) => l.id === id) ?? null : null);
  const reactionRunning = team.processes.filter((p) => p.kind === 'reaction');
  const processRunning = team.processes.filter((p) => p.kind === 'process');
  const slotCount = 2 + (team.equipment.some((e) => e.id === 'U01') ? 1 : 0);
  const auction = game.auction;

  const activeCls = (t: MobileTab) => (tab === t ? 'active-tab' : '');

  return (
    <div className="board">
      <header className="board-head">
        <Wordmark compact />
        <span className="round-label">R{game.round}/{game.roundsTotal}</span>
        <span className={`phase-pill phase-${game.phase}`}>{PHASE_LABEL[game.phase]}{view.room.status === 'paused' ? ' · 일시정지' : ''}</span>
        <span className={`timer ${seconds <= 10 && game.phase === 'execute' && !manual ? 'low' : ''}`} aria-live="off">{manual ? '수동' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}</span>
        <span className="stat"><CoinIcon /> {team.coins}{team.bid > 0 && <span className="muted small">(입찰 예약 {team.bid})</span>}</span>
        <span className="stat"><EnergyIcon /> {team.energy}/{game.config.energyCap}</span>
        <span className="stat"><ActionIcon /> {game.phase === 'execute' ? team.actionsLeft : '-'}/{game.config.actionsPerRound}</span>
        <span className={`stat ${me.isOperator && game.phase === 'execute' ? 'pulse' : ''}`} style={{ background: me.isOperator ? 'var(--amber-soft)' : undefined }}>담당 {operatorNick}{me.isOperator ? ' (나)' : ''}</span>
        <span style={{ flex: 1 }} />
        {headerExtra}
        <button className="btn btn-sm btn-copper" onClick={() => setHelp(true)}>도움말</button>
        <button className="btn btn-sm btn-ghost" onClick={() => setCodex(true)}>도감</button>
        <button className="btn btn-sm btn-ghost" onClick={onLeave}>나가기</button>
      </header>
      <CoachBar view={view} isLocal={client.kind === 'local'} onGoTab={(t) => setTab(t)} />

      {/* 좌: 주문·상점 */}
      <aside className={`board-left ${activeCls('orders')}`}>
        {auction && (
          <section className="panel" style={{ borderTop: '3px solid var(--amber)' }}>
            <div className="panel-title">도시 특별 계약 · 비공개 입찰 <span className="tag tag-amber">{auction.resolved ? '개봉' : `${auction.bidderCount}팀 참여`}</span></div>
            <ContractCard c={auction.contract} team={team} round={game.round} mode="auction" />
            {auction.resolved ? <p className="small" style={{ marginTop: 6 }}>{auction.winnerId ? `${view.teams.find((t) => t.id === auction.winnerId)?.name ?? '?'} 낙찰` : '유찰'}</p> : (
              <div className="row" style={{ marginTop: 8 }}>
                <input type="range" min={0} max={game.config.auctionMaxBid} value={bidInput ?? auction.myBid} onChange={(e) => setBidInput(Number(e.target.value))} disabled={!canPlan} aria-label="입찰액" style={{ flex: 1 }} />
                <b>{bidInput ?? auction.myBid}코인</b>
                <button className="btn btn-sm btn-copper" disabled={!canPlan || (bidInput ?? auction.myBid) === auction.myBid} onClick={() => send({ type: 'bid', amount: bidInput ?? auction.myBid }, 'sfx-card')}>입찰</button>
              </div>
            )}
            <p className="muted small">0은 불참. 실행 마감에 개봉하며 승자만 지불합니다. 계약 슬롯 1개를 예약합니다.</p>
          </section>
        )}
        <section className="panel">
          <div className="panel-title">보유 계약 <span className="tag">{team.contracts.length}/{game.config.contractLimit}</span></div>
          <div className="stack">
            {team.contracts.length === 0 && <p className="muted small">아직 계약이 없습니다. 아래 제안에서 확보하세요.</p>}
            {team.contracts.map((c) => {
              const sat = contractSatisfiable(team, c);
              return <ContractCard key={c.id} c={c} team={team} round={game.round} mode="held" actions={
                <span className="row">
                  {canAct && sat.ok && <button className="btn btn-sm btn-copper" onClick={() => send({ type: 'deliver', contractId: c.id }, 'sfx-delivery')}>납품</button>}
                  {canPlan && game.phase === 'plan' && !c.special && <button className="btn btn-sm btn-ghost" onClick={() => send({ type: 'cancelContract', contractId: c.id })}>취소</button>}
                  {!canAct && sat.ok && <span className="tag tag-teal">납품 가능</span>}
                </span>} />;
            })}
          </div>
        </section>
        <section className="panel">
          <div className="panel-title">도시 주문 제안 {game.rewardAdjust && Object.keys(game.rewardAdjust).length > 0 && <span className="tag tag-amber">수요 증가</span>}</div>
          <div className="stack">
            {team.offers.map((o) => <ContractCard key={o.id} c={o} team={team} round={game.round} mode="offer" actions={canPlan ? <button className="btn btn-sm btn-primary" onClick={() => send({ type: 'takeContract', offerId: o.id }, 'sfx-card')}>확보</button> : <button className="btn btn-sm btn-ghost" onClick={() => send({ type: 'pin', playerId: me.playerId, target: `offer:${o.templateId}`, label: `${o.title} 제안` }, 'sfx-ping')}>📌</button>} />)}
          </div>
          <p className="muted small" style={{ marginTop: 6 }}>계약 확보는 행동을 쓰지 않습니다. 취소는 계획 단계에만.</p>
        </section>
        <section className="panel">
          <div className="panel-title">상점</div>
          <div className="row">
            <button className="btn btn-block" onClick={() => setShop(true)}>원료 상점</button>
            <button className="btn btn-block" onClick={() => setEquip(true)}>설비·촉매</button>
          </div>
          {game.events.filter((e) => e.announceRound === game.round || e.applyRound === game.round).map((e) => <p key={e.id} className="small" style={{ marginTop: 6, background: 'var(--amber-soft)', padding: 6, borderRadius: 8 }}>{e.applyRound === game.round ? '이번 라운드' : '다음 라운드 예고'}: {e.label}</p>)}
        </section>
      </aside>

      {/* 중앙: 공방 */}
      <main className={`board-center ${activeCls('workshop')}`}>
        <section className="panel">
          <div className="panel-title">반응 슬롯 {reactionRunning.length}/{slotCount} · 가공대 {processRunning.length}/1</div>
          <div className="slots">
            {Array.from({ length: slotCount }, (_, i) => {
              const p = reactionRunning[i];
              if (!p) return <div key={i} className="slot"><AssetImage id="equipment-reactor" alt="" className="slot-img" style={{ opacity: 0.35 }} fallback={<span />} /><span className="muted small">빈 반응 슬롯</span></div>;
              const r = REACTIONS[p.defId]!;
              const total = p.completesRound - p.startedRound + 1;
              const done = game.round - p.startedRound + (game.phase === 'settle' ? 1 : 0.5);
              return <div key={i} className="slot busy"><span className="slot-name">{r.name} ×{p.scale}</span><span className="muted small">{p.inputSummary}</span><div className="gauge"><div style={{ width: `${Math.min(100, (done / total) * 100)}%` }} /></div><span className="small">{p.completesRound <= game.round ? '이번 정산에 완료' : `${p.completesRound}R 정산에 완료`}</span></div>;
            })}
            {(() => {
              const p = processRunning[0];
              if (!p) return <div className="slot process"><AssetImage id="equipment-filter" alt="" className="slot-img" style={{ opacity: 0.35 }} fallback={<span />} /><span className="muted small">가공대 (재고를 눌러 가공)</span></div>;
              return <div className="slot busy process"><span className="slot-name">{PROCESSES[p.defId]!.name}</span><span className="muted small">{p.inputSummary}</span><div className="gauge"><div style={{ width: '60%' }} /></div><span className="small">이번 정산에 완료</span></div>;
            })()}
          </div>
        </section>
        <section className="panel" style={{ flex: 1 }}>
          <div className="panel-title">반응 카드 <span className="muted small" style={{ textTransform: 'none' }}>{me.isOperator && game.phase === 'execute' ? '카드를 눌러 실행' : '카드를 눌러 살펴보고 핑으로 제안'}</span></div>
          <div className="hand">
            {game.activeReactions.map((rid) => <ReactionCard key={rid} rid={rid} team={team} game={game} pinned={pinCount[`reaction:${rid}`] ?? 0} onOpen={() => setOpenReaction(rid)} />)}
          </div>
        </section>
        <section className="panel">
          <div className="panel-title">설비</div>
          <div className="row">
            <span className="tag tag-teal">밀폐 반응 장치 ×2</span><span className="tag tag-teal">기본 가열</span><span className="tag tag-teal">가공대 ×1</span><span className="tag tag-teal">기체 수집</span>
            {team.equipment.map((e) => <span key={e.id} className="tag tag-copper">{EQUIPMENT[e.id]!.name}{e.leased ? ' (임대)' : ''}</span>)}
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
              return <div key={pid} className={`member ${team.operatorId === pid ? 'operator' : ''} ${pid === me.playerId ? 'me' : ''}`}><span className={`dot ${p.connected ? '' : 'off'}`} />{p.nick}{team.operatorId === pid && <span className="tag tag-amber">담당</span>}{p.isLeader && <span className="small">★</span>}</div>;
            })}
          </div>
          <div className="divider" />
          <div className="panel-title">인계 메모</div>
          <textarea className="input" rows={2} placeholder="다음 담당자에게 남길 메모 (선택)" defaultValue={team.memo} key={team.memo} maxLength={200} onBlur={(e) => { if (e.target.value !== team.memo) send({ type: 'memo', text: e.target.value }); }} />
          <div className="panel-title" style={{ marginTop: 8 }}>팀원 제안 핑</div>
          <div className="pins">
            {team.pins.length === 0 && <p className="muted small">카드를 열어 📌로 제안하세요.</p>}
            {team.pins.slice().reverse().map((p, i) => <div key={i} className="pin"><b>{view.players.find((x) => x.id === p.playerId)?.nick ?? '?'}</b>: {p.label}</div>)}
          </div>
        </section>
        <section className="panel">
          <div className="panel-title">인계 정보</div>
          <ul className="small" style={{ margin: 0, paddingLeft: 16 }}>
            {team.processes.map((p) => <li key={p.id}>{p.kind === 'reaction' ? REACTIONS[p.defId]!.name : PROCESSES[p.defId]!.name} → {p.completesRound}R 완료</li>)}
            {team.contracts.map((c) => { const s = contractSatisfiable(team, c); return <li key={c.id}>{c.title}: {s.ok ? '납품 가능' : `부족 ${s.missing.join(', ')}`}</li>; })}
            {team.processes.length === 0 && team.contracts.length === 0 && <li className="muted">진행 중 공정·계약 없음</li>}
          </ul>
        </section>
        <section className="panel">
          <div className="panel-title">다른 길드</div>
          <div className="others">
            {view.teams.filter((t) => t.id !== team.id).map((t) => <div key={t.id} className="other"><Emblem shape={t.emblem} color={t.color} size={20} /><span>{t.name}<div className="muted small">계약 {t.contractsHeld} · 납품 {t.delivered}{t.category ? ` · ${t.category}` : ''}</div></span><Spark data={t.assetHistory} color={t.color} /></div>)}
          </div>
        </section>
        <section className="panel">
          <div className="panel-title">기록</div>
          <div className="small" style={{ maxHeight: 140, overflow: 'auto' }}>{game.log.slice(-12).reverse().map((l, i) => <div key={i} className="muted">R{l.round} {l.text}</div>)}</div>
        </section>
      </aside>

      {/* 하단: 재고 */}
      <section className={`board-inv ${activeCls('inventory')}`}>
        <div className="panel-title">물질 손패 <span className="muted small" style={{ textTransform: 'none' }}>재고를 눌러 자세히 보거나 가공</span></div>
        <div className="lots">
          {team.lots.length === 0 && <p className="muted small">재고가 없습니다. 상점에서 원료를 조달하세요.</p>}
          {team.lots.map((l) => <LotChip key={l.id} lot={l} selected={openLot === l.id} onClick={() => setOpenLot(l.id)} />)}
        </div>
      </section>

      <nav className="mobile-nav" aria-label="화면 전환">
        {(['workshop', 'orders', 'inventory', 'team'] as MobileTab[]).map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{{ workshop: '공방', orders: '주문', inventory: '재고', team: '팀' }[t]}</button>)}
      </nav>

      {openReaction && <ReactionDetail rid={openReaction} team={team} game={game} canAct={canAct} onClose={() => setOpenReaction(null)}
        onRun={async (scale) => { if (await send({ type: 'react', reactionId: openReaction, scale }, 'sfx-reaction-start')) setOpenReaction(null); }}
        onPin={() => send({ type: 'pin', playerId: me.playerId, target: `reaction:${openReaction}`, label: `${REACTIONS[openReaction]!.name} 제안` }, 'sfx-ping')} />}
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
  return <svg className="spark" viewBox={`0 0 ${w} ${h}`} aria-label={`자산 추이 ${data[data.length - 1]}`}><polyline points={pts} fill="none" stroke={color} strokeWidth="2" /></svg>;
}

export function materialName(id: string): string { return MATERIALS[id]?.displayName ?? id; }
export { Formula };
export type { TeamState };
