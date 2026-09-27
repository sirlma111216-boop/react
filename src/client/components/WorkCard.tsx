import type { GameView } from '../../shared/protocol';
import type { ContractInstance, TeamState } from '../../shared/types';
import { REACTIONS } from '../../shared/chemistry/reactions';
import { MATERIALS } from '../../shared/chemistry/materials';
import { EQUIPMENT } from '../../shared/chemistry/equipment';
import { PROCESSES } from '../../shared/chemistry/processes';
import { pickReactantLots } from '../../shared/engine/commands';
import type { CardRelation } from '../../shared/engine/mission';
import type { Route } from '../../shared/engine/reachability';
import { CATALYST_ART, PROCESS_AID } from '../../shared/assets/objectArt';
import { MaterialArt, MixtureArt, ObjectArt } from './Art';
import { slotMaterial } from '../lib/slot';
import { ActionIcon, EnergyIcon, Equation, FormulaBody } from './common';

export type CardState = 'ok' | 'short' | 'equip' | 'slot' | 'energy' | 'lock' | 'wait' | 'actions' | 'ready';

export interface Availability {
  state: CardState;
  text: string;
  scaleMax: 0 | 1 | 2;
  missing: { materialId: string; units: number }[];
  missingEquipment: string[];
  energy: number;
  time: number;
  running: number;
}

/** 서버와 같은 규칙(pickReactantLots)으로 지금 이 카드를 실행할 수 있는지와 실제 원인을 한 줄로 */
export function availability(game: GameView, team: TeamState, rid: string, opts: { isOperator: boolean; operatorNick: string; supportPending: boolean }): Availability {
  const r = REACTIONS[rid]!;
  const owns = (e: string) => team.equipment.some((x) => x.id === e);
  const missingEquipment = (r.requiredEquipment ?? []).filter((e) => !owns(e));
  const time = r.catalystEquipment && owns(r.catalystEquipment) && r.timeWithCatalyst !== undefined ? r.timeWithCatalyst : r.time;
  const energy = r.energy;
  const one = pickReactantLots(team, r, 1);
  const two = pickReactantLots(team, r, 2);
  const scaleMax: 0 | 1 | 2 = two.ok ? 2 : one.ok ? 1 : 0;
  const missing = one.ok ? [] : one.missing;
  const slots = (game.reactionSlots ?? 2) + (owns('U01') ? 1 : 0);
  const running = team.processes.filter((p) => p.kind === 'reaction').length;
  const base = { scaleMax, missing, missingEquipment, energy, time, running };
  if (missingEquipment.length) return { ...base, state: 'equip', text: `${missingEquipment.map((e) => EQUIPMENT[e]!.name).join(', ')}이(가) 필요해요.` };
  const nameOfSlot = (m: string) => MATERIALS[slotMaterial(r.reactants.find((s) => s.accepts[0] === m)?.accepts ?? [m], team, game.shopMaterials)]!.displayName;
  if (missing.length) return { ...base, state: 'short', text: `${missing.map((m) => `${nameOfSlot(m.materialId)} ${m.units}개`).join(', ')}가 부족해요.` };
  if (running >= slots) return { ...base, state: 'slot', text: `빈 반응기가 필요해요 (작업 자리 ${running}/${slots} 사용 중 · 정산 뒤 비어요).` };
  if (team.energy < energy) return { ...base, state: 'energy', text: `에너지 ${energy - team.energy}이(가) 더 필요해요 (지금 ${team.energy}).` };
  if (opts.supportPending) return { ...base, state: 'lock', text: '먼저 이번 라운드 연구지원품을 고르세요.' };
  if (team.roundReady) return { ...base, state: 'ready', text: '준비 완료 상태예요. 준비를 취소하면 할 수 있어요.' };
  if (!opts.isOperator) return { ...base, state: 'wait', text: `재료는 충분해요. 이번 조작: ${opts.operatorNick}` };
  if (team.actionsLeft <= 0) return { ...base, state: 'actions', text: '이번 라운드 행동력을 다 썼어요.' };
  return { ...base, state: 'ok', text: '바로 작업 가능' };
}

const STATE_TAG: Record<CardState, { sym: string; label: string; cls: string }> = {
  ok: { sym: '✓', label: '바로 가능', cls: 'st-ok' },
  short: { sym: '!', label: '재료 부족', cls: 'st-short' },
  equip: { sym: '!', label: '설비 필요', cls: 'st-short' },
  slot: { sym: '⟳', label: '자리 없음', cls: 'st-busy' },
  energy: { sym: '!', label: '에너지 부족', cls: 'st-short' },
  lock: { sym: '▢', label: '지원품 먼저', cls: 'st-wait' },
  wait: { sym: '·', label: '다른 사람 차례', cls: 'st-wait' },
  actions: { sym: '·', label: '행동력 없음', cls: 'st-wait' },
  ready: { sym: '·', label: '준비 완료', cls: 'st-wait' },
};

export function SettleIcon({ size = 18 }: { size?: number }) {
  return <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="9" fill="none" stroke="#17494d" strokeWidth="2.2" /><path d="M12 6v6l4 2" stroke="#b87346" strokeWidth="2.4" fill="none" strokeLinecap="round" /></svg>;
}

/** 헤더 부제: 선택한 의뢰와의 관계 (직접 목표 / 다음 단계 재료) */
function contextLine(rid: string, focus: ContractInstance | null, rel: CardRelation, route: Route | null): string {
  if (!focus || !rel) return '';
  if (rel.kind === 'intermediate') return `${focus.title} · 다음 단계 재료(${MATERIALS[rel.materialId]?.displayName ?? rel.materialId})`;
  if (route && route.reactionId === rid && route.processIds.length) return `${focus.title} · ${route.processIds.map((p) => PROCESSES[p]!.name.replace(/하기$/, '')).join('·')} 전 단계`;
  return `${focus.title}에 바로 쓰여요`;
}

export interface WorkCardProps {
  rid: string;
  game: GameView;
  team: TeamState;
  av: Availability;
  focus: ContractInstance | null;
  relation: CardRelation;
  route: Route | null;
  selected: boolean;
  pinned: number;
  running: boolean;
  onSelect: () => void;
  onRun: (scale: 1 | 2) => void;
  onShort: () => void;
  onEquip: (eq: string) => void;
  onDetail: () => void;
  onPin: () => void;
}

/**
 * 만들기(작업) 카드 — 6영역 고정: ① 헤더 ② 재료 → 결과 ③ 반응식 ④ 비용 ⑤ 가능 여부 ⑥ 행동.
 * 정보를 줄이거나 반응식을 숨기지 않고, 읽는 순서와 폭·상태 표시로 정리한다.
 */
export function WorkCard({ rid, game, team, av, focus, relation, route, selected, pinned, running, onSelect, onRun, onShort, onEquip, onDetail, onPin }: WorkCardProps) {
  const r = REACTIONS[rid]!;
  const st = STATE_TAG[av.state];
  const prodMult = r.extentModel.type === 'partial' ? r.extentModel.extent : r.batchMultiplier;
  const stockOf = (ids: string[]) => team.lots.filter((l) => l.kind === 'pure' && ids.includes(l.materialId!)).reduce((a, l) => a + l.units, 0);
  const shortOf = (id: string) => av.missing.find((m) => m.materialId === id)?.units ?? 0;
  const targetMat = relation?.kind === 'intermediate' ? relation.materialId : focus?.requirements.find((q) => r.outputs.some((o) => o.products.some((p) => p.materialId === q.materialId)))?.materialId;
  const headMat = targetMat && r.outputs.some((o) => o.products.some((p) => p.materialId === targetMat)) ? targetMat : r.outputs[0]!.products[0]!.materialId;
  const ctx = contextLine(rid, focus, relation, route);
  const catalyst = r.catalystEquipment && r.timeWithCatalyst !== undefined ? r.catalystEquipment : null;
  const ownsCat = catalyst ? team.equipment.some((e) => e.id === catalyst) : false;
  const aid = PROCESS_AID[rid];
  const needsSort = r.outputs.some((o) => o.mixture || o.products.some((p) => p.materialId === 'H2O_g'));
  return (
    <article className={`wcard ${st.cls} ${selected ? 'sel' : ''} ${relation?.kind === 'direct' ? 'rel-direct' : relation ? 'rel-mid' : ''}`} aria-label={`${r.name} 작업 카드 · ${st.label}`}>
      {pinned > 0 && <span className="pinmark">추천 {pinned}</span>}
      <button className="wc-head" onClick={onSelect} aria-pressed={selected} title="눌러서 의뢰 보드에서 관련 물질 보기">
        <MaterialArt materialId={headMat} size={56} />
        <span className="wc-title-wrap">
          <span className="wc-title">{r.name}</span>
          {ctx ? <span className="wc-sub">{ctx}</span> : <span className="wc-sub muted">{r.conditions}</span>}
        </span>
        <span className={`wc-state ${st.cls}`}><span aria-hidden>{st.sym}</span> {running ? '가동 중' : st.label}</span>
      </button>

      <div className="wc-flow">
        <div className="wc-in" aria-label="재료">
          {r.reactants.map((s, i) => {
            const need = s.coef * r.batchMultiplier;
            const short = shortOf(s.accepts[0]!);
            const mid = slotMaterial(s.accepts, team, game.shopMaterials);
            return (
              <span key={i} className={`wc-mat ${short ? 'short' : ''}`}>
                {i > 0 && <span className="wc-plus" aria-hidden>+</span>}
                <MaterialArt materialId={mid} size={52} />
                <span className="wc-mat-text">
                  <span className="wc-mat-name">{MATERIALS[mid]!.displayName}</span>
                  <b className="wc-qty">×{need}</b>
                  <span className={`wc-have ${short ? 'short' : ''}`}>{short ? `${short}개 부족` : `창고 ${stockOf(s.accepts)}`}{s.dissolve ? ' · 물에 녹여 넣음' : ''}</span>
                </span>
              </span>
            );
          })}
        </div>
        <div className="wc-arrow" aria-hidden>→</div>
        <div className="wc-out" aria-label="결과">
          {r.outputs.map((o, i) => o.mixture ? (
            <span key={i} className="wc-mixout">
              <MixtureArt lot={{ id: `p${i}`, kind: 'mixture', components: o.products.map((p) => ({ materialId: p.materialId, units: p.coef * (r.extentModel.type === 'partial' ? 1 : prodMult) })), units: 0, grade: 'produced', tags: o.tags, solvent: 0, origin: { type: 'reaction', chain: [] } }} size={52} />
              <span className="wc-mat-text">
                <span className="wc-mat-name">섞여 나옴</span>
                <span className="wc-mixlist">{o.products.map((p) => `${MATERIALS[p.materialId]!.displayName} ${p.coef}`).join(' + ')}</span>
                <span className="wc-proc">◆ 정리 필요</span>
              </span>
            </span>
          ) : o.products.map((p) => (
            <span key={`${i}-${p.materialId}`} className="wc-mat out">
              <MaterialArt materialId={p.materialId} size={52} />
              <span className="wc-mat-text">
                <span className="wc-mat-name">{MATERIALS[p.materialId]!.displayName}</span>
                <b className="wc-qty">×{p.coef}</b>
                {p.materialId === 'H2O_g' && <span className="wc-proc">◆ 응축 필요</span>}
              </span>
            </span>
          )))}
        </div>
      </div>

      <div className="wc-eq"><Equation text={r.equation} /></div>

      <div className="wc-cost">
        <span className="wc-costi"><EnergyIcon size={18} /> 에너지 <b>{av.energy}</b></span>
        <span className="wc-costi"><ActionIcon size={18} /> 행동력 <b>1</b></span>
        <span className="wc-costi" title="라운드가 이 횟수만큼 마무리(정산)되면 완성돼요. 실제 시간(초)이 아니에요."><SettleIcon size={18} /> 정산 <b>{av.time}회</b> 뒤 완성</span>
        {catalyst && <span className={`wc-chip ${ownsCat ? 'on' : ''}`}><ObjectArt id={CATALYST_ART[catalyst] ?? 'aid-manganese-dioxide'} size={22} variant="s" />{EQUIPMENT[catalyst]!.name} {ownsCat ? '적용 중' : `있으면 정산 ${r.timeWithCatalyst}회`}</span>}
        {aid && <span className="wc-chip"><ObjectArt id={aid.assetId} size={22} variant="s" />{aid.label}</span>}
        {r.extentModel.type === 'partial' && <span className="wc-chip warn">일부만 반응 (남은 재료는 정제로 회수)</span>}
        {needsSort && <span className="wc-chip">완성 뒤 정리하기 1번</span>}
      </div>

      <p className={`wc-avail ${st.cls}`} role="status"><span aria-hidden>{st.sym}</span> {av.text}</p>

      <div className="wc-actions">
        <button className="btn btn-sm btn-ghost wc-more" onClick={onDetail}>자세히 · 왜 이만큼?</button>
        <span style={{ flex: 1 }} />
        {av.state === 'ok' && <>
          {av.scaleMax >= 2 && team.energy >= av.energy * 2 && <button className="btn btn-copper" onClick={() => onRun(2)}>두 배로 ×2</button>}
          <button className="btn btn-primary wc-go" onClick={() => onRun(1)}>반응 시작</button>
        </>}
        {av.state === 'short' && <button className="btn btn-copper" onClick={onShort}>부족한 재료 보기</button>}
        {av.state === 'equip' && <button className="btn btn-copper" onClick={() => onEquip(av.missingEquipment[0]!)}>설비 확인</button>}
        {av.state === 'slot' && <button className="btn btn-ghost" onClick={() => onEquip('U01')}>추가 반응기 보기</button>}
        {av.state === 'energy' && <button className="btn btn-copper" onClick={() => onEquip('energy')}>에너지 충전하러 가기</button>}
        {(av.state === 'wait' || av.state === 'lock' || av.state === 'ready' || av.state === 'actions') && <button className="btn btn-ghost" onClick={onPin}>👍 팀원에게 추천</button>}
      </div>
      <span className="sr-only"><FormulaBody formula={MATERIALS[headMat]?.formula ?? ''} /></span>
    </article>
  );
}
