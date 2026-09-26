import { useState } from 'react';
import type { ClientView } from '../../shared/protocol';
import type { ContractRequirement, Lot, TeamState } from '../../shared/types';
import { REACTIONS } from '../../shared/chemistry/reactions';
import { MATERIALS } from '../../shared/chemistry/materials';
import { PROCESSES, applyProcess, applicableProcesses } from '../../shared/chemistry/processes';
import { EQUIPMENT } from '../../shared/chemistry/equipment';
import { computeReachability, routesFor, type ReachabilityMap } from '../../shared/engine/reachability';
import { contractSatisfiable } from '../../shared/engine/commands';
import { reactionStatus } from './ReactionCard';
import { Modal } from './common';
import { prefGet, prefSet } from '../lib/session';

export type CoachTab = 'workshop' | 'orders' | 'team' | 'inventory';

export interface Hint {
  step: string;
  detail: string;
  tab: CoachTab;
  target?: string;
}

const reachCache = new Map<string, ReachabilityMap>();
function mapFor(view: ClientView): ReachabilityMap {
  const g = view.game!;
  const key = `${g.activeReactions.join(',')}|${g.shopMaterials.join(',')}|${g.activeEquipment.join(',')}`;
  let m = reachCache.get(key);
  if (!m) { m = computeReachability(g.activeReactions, g.shopMaterials, g.activeEquipment); reachCache.set(key, m); }
  return m;
}

function unmetRequirements(team: TeamState, reqs: ContractRequirement[]): ContractRequirement[] {
  return reqs.filter((r) => {
    const have = team.lots.filter((l) => l.kind === 'pure' && l.materialId === r.materialId && l.grade !== 'purchased' && l.tags.some((t) => r.tags.includes(t))).reduce((a, l) => a + l.units, 0);
    return have < r.units;
  });
}

function processFor(lot: Lot, req: ContractRequirement): string | null {
  for (const pid of applicableProcesses(lot)) {
    const res = applyProcess(pid, lot, () => 'probe');
    if (res.ok && res.outputs.some((o) => o.kind === 'pure' && o.materialId === req.materialId && o.tags.some((t) => req.tags.includes(t)))) return pid;
    if (res.ok) for (const o of res.outputs) for (const pid2 of applicableProcesses(o)) {
      const r2 = applyProcess(pid2, o, () => 'probe');
      if (r2.ok && r2.outputs.some((x) => x.kind === 'pure' && x.materialId === req.materialId && x.tags.some((t) => req.tags.includes(t)))) return pid;
    }
  }
  return null;
}

const nm = (id: string) => MATERIALS[id]?.displayName ?? id;

/** 지금 할 일 한 줄. 가장 가까운 합법 행동을 제안하며 최적 경로를 강제하지 않는다. */
export function nextHint(view: ClientView, isLocal: boolean): Hint {
  const g = view.game;
  const t = g?.myTeam;
  if (!g || !t) return { step: '구경 중', detail: '팀에 들어가 있지 않아요.', tab: 'team' };
  const nextBtn = isLocal ? ' 다 했으면 위의 "다음 ▶"을 누르세요.' : '';
  if (g.phase === 'finished') return { step: '게임 끝', detail: '결과를 확인하세요.', tab: 'workshop' };
  if (g.phase === 'settle') return { step: '마무리', detail: `이번 라운드에 만들기 시작한 것이 완성되어 창고에 들어와요.${nextBtn}`, tab: 'inventory' };

  const map = mapFor(view);
  const deliverable = t.contracts.find((c) => contractSatisfiable(t, c).ok);
  const isOp = view.me.isOperator;

  if (g.phase === 'plan') {
    if (t.contracts.length === 0 && t.offers.length) return { step: '① 주문 받기', detail: '"새 주문"에서 하나를 골라 "받기"를 누르세요. 행동을 쓰지 않아요. 기한이 넉넉하고 보상이 큰 걸 고르면 좋아요.' + nextBtn, tab: 'orders', target: 'offer' };
    if (g.auction && !g.auction.resolved && t.contracts.length < g.config.contractLimit) return { step: '특별 주문 입찰', detail: '도시 특별 주문에 0~6코인을 몰래 써낼 수 있어요. 끝낼 자신이 있을 때만!' + nextBtn, tab: 'orders' };
    return { step: '상의 시간', detail: `행동 시간이 되면 차례인 사람이 ${g.config.actionsPerRound}번 행동해요. 지금은 카드와 창고를 둘러보세요.${nextBtn}`, tab: 'workshop' };
  }

  if (!isOp) return { step: '친구 차례', detail: `이번 라운드는 ${view.players.find((p) => p.id === t.operatorId)?.nick ?? '다른 팀원'} 차례예요. 카드를 열어 👍 추천으로 도와주세요.`, tab: 'workshop' };
  if (t.actionsLeft <= 0) return { step: '행동 끝', detail: `이번 라운드 행동을 다 썼어요.${nextBtn}`, tab: 'workshop' };
  if (deliverable) return { step: '⑤ 배달하기', detail: `"${deliverable.title}" 준비 끝! 주문 카드의 배달 버튼을 누르면 +${deliverable.reward}코인.`, tab: 'orders', target: `contract:${deliverable.id}` };
  if (t.contracts.length === 0 && t.offers.length) return { step: '① 주문 받기', detail: '먼저 "새 주문"에서 주문을 받으세요 (행동을 쓰지 않아요).', tab: 'orders', target: 'offer' };

  for (const c of t.contracts) {
    for (const req of unmetRequirements(t, c.requirements)) {
      for (const lot of t.lots) {
        const pid = processFor(lot, req);
        if (pid) {
          const p = PROCESSES[pid]!;
          const owns = !p.requiredEquipment || t.equipment.some((e) => e.id === p.requiredEquipment);
          if (!owns) return { step: '장비 필요', detail: `${nm(req.materialId)}을(를) 얻으려면 "${EQUIPMENT[p.requiredEquipment!]!.name}" 장비가 필요해요. 장비 가게에서 사세요.`, tab: 'orders', target: 'shop' };
          const label = lot.kind === 'pure' ? nm(lot.materialId!) : '섞인 것';
          return { step: '④ 정리하기', detail: `창고의 "${label}"을(를) 눌러 "${p.name}"를 하세요. 바로 ${nm(req.materialId)}이(가) 돼요.`, tab: 'inventory', target: `lot:${lot.id}` };
        }
      }
      const pending = t.processes.find((p) => p.outputs.some((o) => (o.kind === 'pure' && o.materialId === req.materialId) || (o.kind === 'mixture' && o.components?.some((x) => x.materialId === req.materialId))));
      if (pending) {
        const name = pending.kind === 'reaction' ? REACTIONS[pending.defId]!.name : PROCESSES[pending.defId]!.name;
        return { step: '③ 완성 기다리기', detail: `"${name}"이(가) ${pending.completesRound}라운드 마무리 때 완성돼요. 남은 행동으로 다른 주문을 준비해 보세요.${nextBtn}`, tab: 'workshop' };
      }
      const routes = routesFor(map, req.materialId, req.tags).filter((r) => g.activeReactions.includes(r.reactionId));
      for (const r of routes) {
        const st = reactionStatus(t, r.reactionId, g);
        if (st.canRun) {
          const scale = st.scaleMax >= 2 && req.units > r.yieldPerBatch && t.energy >= st.energy * 2 ? 2 : 1;
          return { step: '② 만들기', detail: `만들기 카드 "${REACTIONS[r.reactionId]!.name}"을 눌러 ${scale === 2 ? '두 배로 만들기 ×2' : '만들기 ×1'}. ${r.processIds.length ? '완성되면 정리하기가 필요해요.' : '완성되면 바로 배달할 수 있어요.'}`, tab: 'workshop', target: `reaction:${r.reactionId}` };
        }
      }
      if (routes.length && routes.every((r) => reactionStatus(t, r.reactionId, g).reason === '작업 자리 없음')) return { step: '작업 자리 대기', detail: '작업 자리가 모두 사용 중이에요. 마무리가 지나면 비어요. "추가 반응기" 장비를 사면 자리가 늘어요.', tab: 'workshop' };
      for (const r of routes) {
        const st = reactionStatus(t, r.reactionId, g);
        if (st.reason === '재료 부족') return { step: '재료 사기', detail: `"${REACTIONS[r.reactionId]!.name}"에 ${st.detail}이(가) 더 필요해요. 재료 가게에서 사세요 (행동 1).`, tab: 'orders', target: 'shop' };
        if (st.reason === '에너지 부족') return { step: '에너지 충전', detail: `에너지가 부족해요 (${st.detail}). 재료 가게 아래 "에너지 충전"에서 채우세요.`, tab: 'orders', target: 'shop' };
        if (st.reason === '장비 필요') return { step: '장비 필요', detail: `"${REACTIONS[r.reactionId]!.name}"에는 ${st.detail} 장비가 필요해요. 장비 가게에서 사세요.`, tab: 'orders', target: 'shop' };
      }
    }
  }
  const anyRun = g.activeReactions.find((rid) => reactionStatus(t, rid, g).canRun);
  if (anyRun) return { step: '② 만들기', detail: `재료가 있는 "${REACTIONS[anyRun]!.name}"을 만들어 볼 수 있어요.`, tab: 'workshop', target: `reaction:${anyRun}` };
  return { step: '다음 준비', detail: '주문을 더 받거나 재료 가게에서 다음 라운드 재료를 사 두세요.', tab: 'orders' };
}

export function CoachBar({ view, isLocal, onGoTab }: { view: ClientView; isLocal: boolean; onGoTab: (tab: CoachTab) => void }) {
  const [hidden, setHidden] = useState(prefGet('coach', '1') !== '1');
  const hint = nextHint(view, isLocal);
  if (hidden) return <div className="coach coach-min"><button className="btn btn-sm btn-ghost" onClick={() => { setHidden(false); prefSet('coach', '1'); }}>💡 지금 할 일 보기</button></div>;
  return (
    <div className="coach" role="status" aria-live="polite">
      <span className="coach-step">💡 {hint.step}</span>
      <span className="coach-detail">{hint.detail}</span>
      <button className="btn btn-sm btn-primary coach-go" onClick={() => onGoTab(hint.tab)}>{{ workshop: '공방으로', orders: '주문으로', inventory: '창고로', team: '팀으로' }[hint.tab]}</button>
      <button className="x" style={{ width: 28, height: 28, fontSize: 14 }} aria-label="안내 숨기기" onClick={() => { setHidden(true); prefSet('coach', '0'); }}>×</button>
    </div>
  );
}

export function HelpModal({ onClose, isLocal }: { onClose: () => void; isLocal: boolean }) {
  return (
    <Modal title="이렇게 놀아요 (1분)" onClose={onClose}>
      <div className="stack">
        <p>우리 팀은 작은 <b>화학 공방</b>이에요. 도시에서 들어오는 <b>주문</b>을 만들어 <b>배달</b>하고 코인을 모읍니다. 마지막에 코인이 가장 많은 팀이 이겨요.</p>
        <ol className="help-steps">
          <li><b>주문 받기</b> — "새 주문"에서 하나를 고릅니다. (행동을 쓰지 않아요)</li>
          <li><b>만들기</b> — 행동 시간에 <b>만들기 카드</b>를 눌러 "만들기". 재료가 있는 카드는 초록 테두리예요.</li>
          <li><b>완성 기다리기</b> — 라운드 마무리 때 완성품이 <b>창고</b>에 들어와요.</li>
          <li><b>정리하기</b> — 수증기는 "응축하기", 섞인 것은 "거르기"로 정리해요. 기다림 없이 바로 돼요.</li>
          <li><b>배달하기</b> — 주문 카드에 ✓가 다 차면 <b>배달</b> 버튼!</li>
        </ol>
        <p className="small">라운드마다 <b>상의 시간 → 행동 시간 → 마무리</b>가 이어져요. 행동 시간에는 팀의 차례인 사람이 <b>3번</b> 행동해요(사기·만들기·정리하기·배달·장비). 재료가 없으면 <b>재료 가게</b>에서 사요. 가게에서 산 재료는 그대로 배달할 수 없어요 — 직접 만들어야 해요.</p>
        {isLocal && <p className="small" style={{ background: 'var(--amber-soft)', padding: 8, borderRadius: 8 }}>연습에서는 시간이 저절로 흐르지 않아요. 할 일을 마치면 위의 <b>다음 ▶</b>을 누르세요. 💡 안내가 다음 할 일을 알려줘요.</p>}
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-primary" onClick={onClose}>시작하기</button></div>
      </div>
    </Modal>
  );
}
