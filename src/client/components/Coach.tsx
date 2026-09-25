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
  /** 강조할 대상 (reaction:R01, lot:<id>, offer, contract:<id>, shop) */
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

/** 로트에 어떤 공정을 적용하면 요구 물질(태그 포함)이 나오는가 */
function processFor(lot: Lot, req: ContractRequirement): string | null {
  for (const pid of applicableProcesses(lot)) {
    const res = applyProcess(pid, lot, () => 'probe');
    if (res.ok && res.outputs.some((o) => o.kind === 'pure' && o.materialId === req.materialId && o.tags.some((t) => req.tags.includes(t)))) return pid;
    // 2단계 (예: 여과 → 결정화)
    if (res.ok) for (const o of res.outputs) for (const pid2 of applicableProcesses(o)) {
      const r2 = applyProcess(pid2, o, () => 'probe');
      if (r2.ok && r2.outputs.some((x) => x.kind === 'pure' && x.materialId === req.materialId && x.tags.some((t) => req.tags.includes(t)))) return pid;
    }
  }
  return null;
}

const matName = (id: string) => MATERIALS[id]?.displayName ?? id;

/** 현재 상황에서 다음에 할 일을 한 줄로 계산한다. 최적 경로를 강제하지 않고 가장 가까운 합법 행동을 제안한다. */
export function nextHint(view: ClientView, isLocal: boolean): Hint {
  const g = view.game;
  const t = g?.myTeam;
  if (!g || !t) return { step: '관전 중', detail: '팀에 속해 있지 않습니다.', tab: 'team' };
  const nextBtn = isLocal ? ' 준비되면 오른쪽 위 "다음 단계 ▶"를 누르세요.' : '';
  if (g.phase === 'finished') return { step: '경기 종료', detail: '결과를 확인하세요.', tab: 'workshop' };
  if (g.phase === 'settle') return { step: '정산 중', detail: `이번 라운드에 시작한 공정이 완료되어 재고로 들어옵니다.${nextBtn}`, tab: 'inventory' };

  const map = mapFor(view);
  const deliverable = t.contracts.find((c) => contractSatisfiable(t, c).ok);
  const isOp = view.me.isOperator;

  if (g.phase === 'plan') {
    if (t.contracts.length === 0 && t.offers.length) return { step: '① 계약 확보', detail: '"도시 주문 제안"에서 계약 하나를 확보하세요. 행동을 쓰지 않습니다. 짧은 기한·높은 보상을 고르면 좋습니다.' + nextBtn, tab: 'orders', target: 'offer' };
    if (g.auction && !g.auction.resolved && t.contracts.length < g.config.contractLimit) return { step: '특별 계약 입찰', detail: '도시 특별 계약에 0~6코인을 비공개로 입찰할 수 있습니다. 완수할 자신이 있을 때만.' + nextBtn, tab: 'orders' };
    return { step: '계획 단계', detail: `실행 단계가 되면 담당자가 행동 ${g.config.actionsPerRound}개를 씁니다. 지금은 카드와 재고를 살펴보세요.${nextBtn}`, tab: 'workshop' };
  }

  // execute
  if (!isOp) return { step: '담당자 차례', detail: `이번 라운드 담당자는 ${view.players.find((p) => p.id === t.operatorId)?.nick ?? '다른 팀원'}입니다. 카드를 열어 📌 핑으로 제안하세요.`, tab: 'workshop' };
  if (t.actionsLeft <= 0) return { step: '행동 완료', detail: `이번 라운드 행동을 모두 썼습니다. 정산을 기다리세요.${nextBtn}`, tab: 'workshop' };
  if (deliverable) return { step: '⑤ 납품', detail: `"${deliverable.title}" 조건이 채워졌습니다. 계약 카드의 납품 버튼을 누르면 +${deliverable.reward}코인.`, tab: 'orders', target: `contract:${deliverable.id}` };
  if (t.contracts.length === 0 && t.offers.length) return { step: '① 계약 확보', detail: '먼저 "도시 주문 제안"에서 계약을 확보하세요 (행동 소모 없음).', tab: 'orders', target: 'offer' };

  for (const c of t.contracts) {
    for (const req of unmetRequirements(t, c.requirements)) {
      // 가공하면 되는 재고가 있는가
      for (const lot of t.lots) {
        const pid = processFor(lot, req);
        if (pid) {
          const p = PROCESSES[pid]!;
          const owns = !p.requiredEquipment || t.equipment.some((e) => e.id === p.requiredEquipment);
          if (!owns) return { step: '설비 필요', detail: `${matName(req.materialId)}을(를) 얻으려면 ${EQUIPMENT[p.requiredEquipment!]!.name}이 필요합니다. "설비·촉매"에서 설치하세요.`, tab: 'orders', target: 'shop' };
          if (t.processes.some((x) => x.kind === 'process')) return { step: '가공대 사용 중', detail: '가공대가 비면 재고를 눌러 가공하세요. 지금은 다른 반응을 실행해 두면 좋습니다.', tab: 'workshop' };
          const label = lot.kind === 'pure' ? matName(lot.materialId!) : '혼합물';
          return { step: '④ 가공', detail: `재고의 "${label}"을(를) 눌러 "${p.name}"을 실행하세요. 다음 정산에 ${matName(req.materialId)}이(가) 됩니다.`, tab: 'inventory', target: `lot:${lot.id}` };
        }
      }
      // 진행 중 공정이 만들어 줄 예정인가
      const pending = t.processes.find((p) => p.outputs.some((o) => (o.kind === 'pure' && o.materialId === req.materialId) || (o.kind === 'mixture' && o.components?.some((x) => x.materialId === req.materialId))));
      if (pending) {
        const name = pending.kind === 'reaction' ? REACTIONS[pending.defId]!.name : PROCESSES[pending.defId]!.name;
        return { step: '③ 정산 기다리기', detail: `"${name}"이 ${pending.completesRound}라운드 정산에 완료됩니다. 남는 행동으로 다른 계약을 준비하세요.${nextBtn}`, tab: 'workshop' };
      }
      // 지금 실행할 수 있는 반응
      const routes = routesFor(map, req.materialId, req.tags).filter((r) => g.activeReactions.includes(r.reactionId));
      for (const r of routes) {
        const st = reactionStatus(t, r.reactionId, g);
        if (st.canRun) {
          const scale = st.scaleMax >= 2 && req.units > r.yieldPerBatch && t.energy >= st.energy * 2 ? 2 : 1;
          return { step: '② 반응 실행', detail: `반응 카드 "${REACTIONS[r.reactionId]!.name}"을 눌러 실행 ×${scale}. ${r.processIds.length ? '완료 후 가공이 필요합니다.' : '완료되면 바로 납품할 수 있습니다.'}`, tab: 'workshop', target: `reaction:${r.reactionId}` };
        }
      }
      // 슬롯이 꽉 찼으면 기다리기
      if (routes.length && routes.every((r) => reactionStatus(t, r.reactionId, g).reason === '빈 반응 슬롯 없음')) return { step: '반응 슬롯 대기', detail: '반응 슬롯이 모두 사용 중입니다. 정산 후 비거나, 설비 "추가 반응기"를 살 수 있습니다.', tab: 'workshop' };
      // 원료 구매
      for (const r of routes) {
        const st = reactionStatus(t, r.reactionId, g);
        if (st.reason === '원료 부족') {
          const need = r.inputsPerBatch.map((i) => `${matName(i.materialId)} ${i.units}칸`).join(', ');
          return { step: '원료 조달', detail: `"${REACTIONS[r.reactionId]!.name}" 반응에 ${need}이(가) 필요합니다. "원료 상점"에서 부족한 만큼 사세요 (행동 1).`, tab: 'orders', target: 'shop' };
        }
        if (st.reason.startsWith('에너지')) return { step: '에너지 충전', detail: `${st.reason}. 원료 상점 아래 "에너지 충전"으로 채우세요.`, tab: 'orders', target: 'shop' };
        if (st.reason.startsWith('필요 설비')) return { step: '설비 필요', detail: `${REACTIONS[r.reactionId]!.name}: ${st.reason}. "설비·촉매"에서 설치하세요.`, tab: 'orders', target: 'shop' };
      }
    }
  }
  const anyRun = g.activeReactions.find((rid) => reactionStatus(t, rid, g).canRun);
  if (anyRun) return { step: '② 반응 실행', detail: `재료가 있는 반응 "${REACTIONS[anyRun]!.name}"을 실행해 볼 수 있습니다.`, tab: 'workshop', target: `reaction:${anyRun}` };
  return { step: '다음 준비', detail: '계약을 더 확보하거나 원료 상점에서 다음 라운드 재료를 사 두세요.', tab: 'orders' };
}

export function CoachBar({ view, isLocal, onGoTab }: { view: ClientView; isLocal: boolean; onGoTab: (tab: CoachTab) => void }) {
  const [hidden, setHidden] = useState(prefGet('coach', '1') !== '1');
  const hint = nextHint(view, isLocal);
  if (hidden) return <div className="coach coach-min"><button className="btn btn-sm btn-ghost" onClick={() => { setHidden(false); prefSet('coach', '1'); }}>💡 지금 할 일 보기</button></div>;
  return (
    <div className="coach" role="status" aria-live="polite">
      <span className="coach-step">💡 {hint.step}</span>
      <span className="coach-detail">{hint.detail}</span>
      <button className="btn btn-sm btn-primary coach-go" onClick={() => onGoTab(hint.tab)}>{{ workshop: '공방으로', orders: '주문으로', inventory: '재고로', team: '팀으로' }[hint.tab]}</button>
      <button className="x" style={{ width: 28, height: 28, fontSize: 14 }} aria-label="안내 숨기기" onClick={() => { setHidden(true); prefSet('coach', '0'); }}>×</button>
    </div>
  );
}

export function HelpModal({ onClose, isLocal }: { onClose: () => void; isLocal: boolean }) {
  return (
    <Modal title="90초 안내 — 이렇게 놀아요" onClose={onClose}>
      <div className="stack">
        <p>작은 화학 공방을 운영합니다. 목표는 <b>도시의 주문에 납품해서 코인을 모으는 것</b>. 아래 다섯 단계를 반복합니다.</p>
        <ol className="help-steps">
          <li><b>계약 확보</b> — {'"도시 주문 제안"'}(휴대전화는 <b>주문</b> 탭)에서 계약 하나를 <b>확보</b>. 행동을 쓰지 않습니다.</li>
          <li><b>반응 실행</b> — 실행 단계에 <b>공방</b>의 반응 카드를 눌러 <b>실행 ×1/×2</b>. 재료가 있는 카드는 초록 테두리입니다.</li>
          <li><b>정산 기다리기</b> — 라운드가 끝나면(정산) 생성물이 <b>재고</b>에 들어옵니다.</li>
          <li><b>가공</b> — 수증기·혼합물은 재고를 눌러 <b>응축·고체 회수</b> 등으로 가공해야 납품할 수 있습니다.</li>
          <li><b>납품</b> — 조건이 채워진 계약 카드의 <b>납품</b> 버튼. 코인이 들어옵니다.</li>
        </ol>
        <p className="small">라운드마다 <b>계획 → 실행 → 정산</b>이 이어지고, 실행 단계에는 팀당 <b>행동 2개</b>(조달·생산·가공·납품·설비)를 씁니다. 원료가 없으면 <b>원료 상점</b>에서 사세요. 상점에서 산 물질은 그대로 납품할 수 없습니다.</p>
        {isLocal && <p className="small" style={{ background: 'var(--amber-soft)', padding: 8, borderRadius: 8 }}>연습 모드에서는 시간이 자동으로 흐르지 않습니다. 할 일을 마치면 오른쪽 위 <b>다음 단계 ▶</b>를 눌러 진행하세요. 보드 위의 💡 안내가 다음 할 일을 알려줍니다.</p>}
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-primary" onClick={onClose}>시작하기</button></div>
      </div>
    </Modal>
  );
}
