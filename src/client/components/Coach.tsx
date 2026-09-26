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
import type { Place } from '../lib/places';

export interface Hint {
  step: string;
  detail: string;
  place: Place;
  /** 강조할 대상 (reaction:R01, lot:<id>, contract:<id>, offer, ready) */
  target?: string;
}

const reachCache = new Map<string, ReachabilityMap>();
export function mapFor(view: ClientView): ReachabilityMap {
  const g = view.game!;
  const key = `${g.activeReactions.join(',')}|${g.shopMaterials.join(',')}|${g.activeEquipment.join(',')}`;
  let m = reachCache.get(key);
  if (!m) { m = computeReachability(g.activeReactions, g.shopMaterials, g.activeEquipment); reachCache.set(key, m); }
  return m;
}

export function unmetRequirements(team: TeamState, reqs: ContractRequirement[]): ContractRequirement[] {
  return reqs.filter((r) => {
    const have = team.lots.filter((l) => l.kind === 'pure' && l.materialId === r.materialId && l.grade !== 'purchased' && l.tags.some((t) => r.tags.includes(t))).reduce((a, l) => a + l.units, 0);
    return have < r.units;
  });
}

export function processFor(lot: Lot, req: ContractRequirement): string | null {
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

/**
 * 집중 의뢰와 서버 상태에서 추천 한 개. 우선순위: 배달 가능 → 정리 필요 → 만들 수 있음 → 재료 부족 → 완성 대기 → 준비 완료.
 * 정답 하나를 강제하지 않는다 — 플레이어가 고른 의뢰(focusId)를 우선한다.
 */
export function nextHint(view: ClientView, focusId: string | null): Hint {
  const g = view.game;
  const t = g?.myTeam;
  if (!g || !t) return { step: '구경 중', detail: '팀에 들어가 있지 않아요.', place: 'orders' };
  if (g.phase === 'finished') return { step: '게임 끝', detail: '결과를 확인하세요.', place: 'orders' };
  const isOp = view.me.isOperator;
  const opNick = view.players.find((p) => p.id === t.operatorId)?.nick ?? '다른 팀원';
  if (t.roundReady) return { step: '준비 완료', detail: `다른 팀을 기다리는 중 (${g.readyCount}/${g.teamCount}). 모두 준비되면 라운드가 마무리돼요.`, place: 'workshop', target: 'ready' };
  if (!isOp) return { step: `${opNick} 차례`, detail: '카드나 주문을 열어 👍 추천으로 도와줄 수 있어요. 창고와 장소는 자유롭게 볼 수 있어요.', place: 'workshop' };

  const map = mapFor(view);
  const ordered = [...t.contracts].sort((a, b) => (a.id === focusId ? -1 : b.id === focusId ? 1 : 0));
  const deliverable = ordered.find((c) => contractSatisfiable(t, c).ok);
  if (deliverable && t.actionsLeft > 0) return { step: '완성품 준비 끝', detail: `"${deliverable.title}"을(를) 출하장에서 배달할 수 있어요.`, place: 'shipping', target: `contract:${deliverable.id}` };
  if (t.actionsLeft <= 0) return { step: '행동 끝', detail: '이번 라운드 행동을 모두 썼어요. 준비 완료를 누르면 다른 팀을 기다려요.', place: 'workshop', target: 'ready' };
  if (t.contracts.length === 0) return t.offers.length ? { step: '주문 받기', detail: '의뢰소에서 과학자의 주문을 하나 받으세요. 행동을 쓰지 않아요.', place: 'orders', target: 'offer' } : { step: '주문 없음', detail: '이번 라운드에는 새 주문이 없어요. 준비 완료로 다음 라운드를 기다려요.', place: 'orders', target: 'ready' };

  for (const c of ordered) {
    for (const req of unmetRequirements(t, c.requirements)) {
      for (const lot of t.lots) {
        const pid = processFor(lot, req);
        if (pid) {
          const p = PROCESSES[pid]!;
          const owns = !p.requiredEquipment || t.equipment.some((e) => e.id === p.requiredEquipment);
          if (!owns) return { step: '장비 필요', detail: `${nm(req.materialId)}을(를) 얻으려면 "${EQUIPMENT[p.requiredEquipment!]!.name}"이 필요해요. 상점에서 사세요.`, place: 'store', target: `equip:${p.requiredEquipment}` };
          const label = lot.kind === 'pure' ? nm(lot.materialId!) : '섞인 것';
          return { step: '정리하기', detail: `공방 트레이의 "${label}"을(를) "${p.name}"로 정리하면 ${nm(req.materialId)}이(가) 돼요.`, place: 'workshop', target: `lot:${lot.id}` };
        }
      }
      const pending = t.processes.find((p) => p.outputs.some((o) => (o.kind === 'pure' && o.materialId === req.materialId) || (o.kind === 'mixture' && o.components?.some((x) => x.materialId === req.materialId))));
      if (pending) return { step: '완성 기다리기', detail: `"${REACTIONS[pending.defId]?.name ?? '만들기'}"은(는) ${pending.completesRound}라운드 마무리 때 끝나요. 다른 일을 하거나 준비 완료를 눌러요.`, place: 'workshop', target: 'ready' };
      const routes = routesFor(map, req.materialId, req.tags).filter((r) => g.activeReactions.includes(r.reactionId));
      for (const r of routes) {
        const st = reactionStatus(t, r.reactionId, g);
        if (st.canRun) return { step: '만들기', detail: `공방에서 "${REACTIONS[r.reactionId]!.name}" 카드로 만들 수 있어요.${r.processIds.length ? ' 완성 후 정리하기가 필요해요.' : ''}`, place: 'workshop', target: `reaction:${r.reactionId}` };
      }
      if (routes.length && routes.every((r) => reactionStatus(t, r.reactionId, g).reason === '작업 자리 없음')) return { step: '작업 자리 없음', detail: '작업 자리가 모두 사용 중이에요. 마무리 뒤 비거나, 상점에서 "추가 반응기"를 살 수 있어요.', place: 'store', target: 'equip:U01' };
      for (const r of routes) {
        const st = reactionStatus(t, r.reactionId, g);
        if (st.reason === '재료 부족') return { step: '재료 부족', detail: `"${REACTIONS[r.reactionId]!.name}"에 ${st.detail}이(가) 더 필요해요. 상점에서 확인하세요.`, place: 'store', target: `need:${r.reactionId}` };
        if (st.reason === '에너지 부족') return { step: '에너지 부족', detail: `에너지가 부족해요 (${st.detail}). 상점에서 에너지를 충전할 수 있어요.`, place: 'store', target: 'energy' };
        if (st.reason === '장비 필요') return { step: '장비 필요', detail: `"${REACTIONS[r.reactionId]!.name}"에는 ${st.detail}이(가) 필요해요. 상점에서 사세요.`, place: 'store', target: `equip:${r.requiredEquipment[0] ?? ''}` };
      }
    }
  }
  const anyRun = g.activeReactions.find((rid) => reactionStatus(t, rid, g).canRun);
  if (anyRun) return { step: '만들기', detail: `재료가 있는 "${REACTIONS[anyRun]!.name}"을 공방에서 만들어 볼 수 있어요.`, place: 'workshop', target: `reaction:${anyRun}` };
  return { step: '다음 준비', detail: '의뢰소에서 주문을 더 받거나 상점에서 다음 라운드 재료를 사 두세요.', place: 'orders' };
}

export function HelpModal({ onClose, isLocal }: { onClose: () => void; isLocal: boolean }) {
  return (
    <Modal title="이렇게 놀아요 (1분)" onClose={onClose}>
      <div className="stack">
        <p>우리 팀은 작은 <b>화학 공방</b>이에요. 네 장소를 오가며 주문을 만들어 배달하고 코인을 모읍니다. 마지막에 코인이 가장 많은 팀이 이겨요.</p>
        <ol className="help-steps">
          <li><b>📋 의뢰소</b> — 과학자에게 <b>주문</b>을 받아요. (행동을 쓰지 않아요)</li>
          <li><b>🧺 상점</b> — 재료와 장비를 사요. 부족한 재료는 안내가 알려줘요.</li>
          <li><b>⚗️ 공방</b> — 빈 작업 자리를 눌러 <b>만들기 카드</b>로 만들고, 트레이의 완성품을 <b>정리</b>해요.</li>
          <li><b>📦 출하장</b> — 완성품을 <b>배달</b>하면 코인이 들어와요. 시세가 낮으면 다음 라운드에 팔 수도 있어요.</li>
        </ol>
        <p className="small">라운드마다 차례인 사람이 <b>3번</b> 행동해요(사기·만들기·정리·배달·장비). 다 했으면 위의 <b>준비 완료</b>. 모든 팀이 준비되면 라운드가 마무리되고 만들던 것이 완성돼요. <b>제한시간은 없어요.</b> 가게에서 산 재료는 그대로 배달할 수 없어요.</p>
        {isLocal && <p className="small" style={{ background: 'var(--amber-soft)', padding: 8, borderRadius: 8 }}>연습에서는 준비 완료를 누르면 AI 공방이 행동한 뒤 바로 라운드가 마무리돼요.</p>}
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-primary" onClick={onClose}>시작하기</button></div>
      </div>
    </Modal>
  );
}
