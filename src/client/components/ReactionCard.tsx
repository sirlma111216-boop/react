import { useMemo } from 'react';
import type { GameView } from '../../shared/protocol';
import type { TeamState } from '../../shared/types';
import { REACTIONS } from '../../shared/chemistry/reactions';
import { MATERIALS } from '../../shared/chemistry/materials';
import { EQUIPMENT } from '../../shared/chemistry/equipment';
import { massRatio } from '../../shared/chemistry/atoms';
import { Formula, Modal, EnergyIcon } from './common';
import { ParticleView } from './Particles';
import { lotComponents } from '../../shared/chemistry/processes';

function stockOf(team: TeamState, ids: string[]): number {
  let n = 0;
  for (const l of team.lots) if (l.kind === 'pure' && ids.includes(l.materialId!)) n += l.units;
  return n;
}

export function reactionStatus(team: TeamState, rid: string, game: GameView): { canRun: boolean; reason: string; scaleMax: 0 | 1 | 2; energy: number; time: number } {
  const r = REACTIONS[rid]!;
  const owns = (e: string) => team.equipment.some((x) => x.id === e);
  const missingEq = (r.requiredEquipment ?? []).filter((e) => !owns(e));
  const time = r.catalystEquipment && owns(r.catalystEquipment) && r.timeWithCatalyst !== undefined ? r.timeWithCatalyst : r.time;
  let scaleMax: 0 | 1 | 2 = 2;
  for (const s of r.reactants) {
    const have = stockOf(team, s.accepts);
    const per = s.coef * r.batchMultiplier;
    if (have < per) scaleMax = 0;
    else if (have < per * 2 && scaleMax === 2) scaleMax = 1;
  }
  if (missingEq.length) return { canRun: false, reason: `필요 설비: ${missingEq.map((e) => EQUIPMENT[e]!.name).join(', ')}`, scaleMax: 0, energy: r.energy, time };
  if (scaleMax === 0) return { canRun: false, reason: '원료 부족', scaleMax, energy: r.energy, time };
  if (team.energy < r.energy) return { canRun: false, reason: `에너지 부족 (${r.energy} 필요)`, scaleMax, energy: r.energy, time };
  const running = team.processes.filter((p) => p.kind === 'reaction').length;
  const slots = 2 + (owns('U01') ? 1 : 0);
  if (running >= slots) return { canRun: false, reason: '빈 반응 슬롯 없음', scaleMax, energy: r.energy, time };
  void game;
  return { canRun: true, reason: '', scaleMax, energy: r.energy, time };
}

export function ReactionCard({ rid, team, game, pinned, onOpen }: { rid: string; team: TeamState; game: GameView; pinned: number; onOpen: () => void }) {
  const r = REACTIONS[rid]!;
  const st = reactionStatus(team, rid, game);
  return (
    <button className={`rcard ${st.canRun ? 'ready' : ''} ${st.reason.startsWith('필요 설비') ? 'locked' : ''}`} onClick={onOpen} aria-label={`${r.name} 반응 카드`}>
      {pinned > 0 && <span className="pinmark">핑 {pinned}</span>}
      <span className="rname">{r.name}</span>
      <span className="req">{r.reactants.map((s, i) => <span key={i} className={`tag ${stockOf(team, s.accepts) >= s.coef * r.batchMultiplier ? 'tag-teal' : ''}`}><Formula id={s.accepts[0]!} withPhase={false} />×{s.coef * r.batchMultiplier}</span>)}</span>
      <span className="req">→ {r.products.map((p, i) => <span key={i} className="tag"><Formula id={p.materialId} withPhase={false} />×{p.coef * (r.extentModel.type === 'partial' ? r.extentModel.extent : r.batchMultiplier)}</span>)}</span>
      <span className="cost"><span><EnergyIcon size={13} /> {r.energy}</span><span>⏱ {st.time}R</span>{r.exothermic && <span title="발열 반응">🔥</span>}{r.extentModel.type === 'partial' && <span className="tag tag-amber">부분 전환</span>}</span>
      {!st.canRun && <span className="muted small">{st.reason}</span>}
    </button>
  );
}

export function ReactionDetail({ rid, team, game, canAct, onRun, onPin, onClose }: { rid: string; team: TeamState; game: GameView; canAct: boolean; onRun: (scale: 1 | 2) => void; onPin: () => void; onClose: () => void }) {
  const r = REACTIONS[rid]!;
  const st = reactionStatus(team, rid, game);
  const [tab, setTab] = useMemo(() => {
    let t: 'atoms' | 'mass' | 'gas' = 'atoms';
    return [() => t, (v: typeof t) => { t = v; }] as const;
  }, []);
  void tab; void setTab;
  return (
    <Modal title={<span>{r.name} <span className="muted small">{r.id}</span></span>} onClose={onClose} wide>
      <div className="stack">
        <div className="formula" style={{ fontSize: 18, color: 'var(--teal)' }}>{r.equation}</div>
        <p className="muted">{r.conditions} · {r.handling}</p>
        <div className="row">
          <span className="tag"><EnergyIcon size={13} /> 에너지 {r.energy}/배치</span>
          <span className="tag">⏱ {st.time}라운드{r.catalystEquipment && r.timeWithCatalyst !== undefined && (team.equipment.some((e) => e.id === r.catalystEquipment) ? ' (촉매 적용)' : ` · ${EQUIPMENT[r.catalystEquipment]!.name}으로 ${r.timeWithCatalyst}`)}</span>
          {r.exothermic ? <span className="tag tag-copper">발열{r.heatRecoverable ? ' · 열회수 가능' : ''}</span> : <span className="tag tag-teal">흡열</span>}
          {r.requiredEquipment?.map((e) => <span key={e} className={`tag ${team.equipment.some((x) => x.id === e) ? 'tag-teal' : 'tag-danger'}`}>{EQUIPMENT[e]!.name} {team.equipment.some((x) => x.id === e) ? '설치됨' : '필요'}</span>)}
        </div>
        <WhyThisMuch rid={rid} />
        <BatchPreview rid={rid} team={team} />
        {r.extentModel.type === 'partial' && <p className="small" style={{ background: 'var(--amber-soft)', padding: 8, borderRadius: 8 }}>{r.extentModel.note}</p>}
        {r.simplifications.length > 0 && <p className="muted small">단순화: {r.simplifications.join(' ')}</p>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
          <button className="btn btn-ghost" onClick={onPin}>📌 제안 핑</button>
          {canAct ? (
            <>
              <button className="btn btn-primary" disabled={!st.canRun || st.scaleMax < 1} onClick={() => onRun(1)}>실행 ×1</button>
              <button className="btn btn-copper" disabled={!st.canRun || st.scaleMax < 2 || team.energy < r.energy * 2} onClick={() => onRun(2)}>실행 ×2</button>
            </>
          ) : <span className="muted small">{st.canRun ? '담당자만 실행할 수 있습니다' : st.reason}</span>}
        </div>
      </div>
    </Modal>
  );
}

function BatchPreview({ rid, team }: { rid: string; team: TeamState }) {
  const r = REACTIONS[rid]!;
  return (
    <div className="card" style={{ padding: 10 }}>
      <div className="card-title">배치 ×1 투입 → 산출</div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="stack">{r.reactants.map((s, i) => { const need = s.coef * r.batchMultiplier; const have = stockOf(team, s.accepts); return <span key={i} className={`tag ${have >= need ? 'tag-teal' : 'tag-danger'}`}>{MATERIALS[s.accepts[0]!]!.displayName} {need}칸 (보유 {have}){s.dissolve ? ' · 용해' : ''}</span>; })}</div>
        <span className="arrow">→</span>
        <div className="stack">{r.outputs.map((s, i) => <span key={i} className={`tag ${s.mixture ? 'tag-copper' : 'tag-teal'}`}>{s.mixture ? '혼합물: ' : ''}{s.products.map((p) => `${MATERIALS[p.materialId]!.displayName} ${p.coef}칸`).join(' + ')}{s.mixture ? ' (가공 필요)' : ''}</span>)}</div>
      </div>
    </div>
  );
}

/** '왜 이만큼?' — 원자 수 · 질량 · 기체 부피비 전환 */
export function WhyThisMuch({ rid }: { rid: string }) {
  const r = REACTIONS[rid]!;
  return (
    <details className="card" style={{ padding: 10 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--teal)' }}>왜 이만큼? — 원자 · 질량 · 기체 부피</summary>
      <div className="stack" style={{ marginTop: 8 }}>
        <div className="particles">
          {r.reactants.map((s, i) => <ParticleView key={`r${i}`} materialId={s.accepts[0]!} count={s.coef} />)}
          <span className="arrow">→</span>
          {r.products.map((p, i) => <ParticleView key={`p${i}`} materialId={p.materialId} count={p.coef} />)}
        </div>
        <p className="small">원자 수 보존: 반응 전후 각 원소의 원자 수가 같다. {elementSummary(rid)}</p>
        <table className="small" style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr><th style={{ textAlign: 'left' }}>물질</th><th>계수</th><th>몰질량(g/mol)</th><th>질량(계수 × 몰질량)</th><th>원소 질량비</th></tr></thead>
          <tbody>
            {[...r.reactants.map((s) => ({ id: s.accepts[0]!, coef: s.coef })), ...r.products.map((p) => ({ id: p.materialId, coef: p.coef }))].map((x, i) => {
              const m = MATERIALS[x.id]!;
              return <tr key={i} style={{ borderTop: '1px solid var(--ivory-3)' }}><td><Formula id={x.id} /></td><td className="center">{x.coef}</td><td className="center">{m.molarMass}</td><td className="center">{Math.round(x.coef * m.molarMass * 100) / 100}</td><td className="center">{massRatio(m.composition).map((e) => `${e.element} ${e.percent}%`).join(' · ')}</td></tr>;
            })}
          </tbody>
        </table>
        <p className="small muted">질량 보존: 반응물 질량 합 = 생성물 질량 합 (교육용 반올림 원자량 H=1, C=12, N=14, O=16 …). 1칸 = 0.1 mol.</p>
        {r.gasVolumeRatio ? <p className="small"><b>기체 부피비</b> {r.gasVolumeRatio.label} = {r.gasVolumeRatio.ratio}. {r.gasVolumeRatio.note}</p> : <p className="small muted">기체 부피비는 동일 온도·압력의 기체끼리만 비교한다. 이 반응에는 표시하지 않는다.</p>}
        <p className="small muted">출처: {r.scientificSources.join('; ')}</p>
      </div>
    </details>
  );
}

function elementSummary(rid: string): string {
  const r = REACTIONS[rid]!;
  const cnt: Record<string, number> = {};
  for (const s of r.reactants) for (const [el, n] of Object.entries(MATERIALS[s.accepts[0]!]!.composition)) cnt[el] = (cnt[el] ?? 0) + n * s.coef;
  return Object.entries(cnt).map(([el, n]) => `${el} ${n}개`).join(', ');
}

export function lotLabel(lot: { kind: string; materialId?: string; components?: { materialId: string; units: number }[] }): string {
  if (lot.kind === 'pure') return MATERIALS[lot.materialId!]?.displayName ?? lot.materialId!;
  return lotComponents(lot as never).map((c) => `${MATERIALS[c.materialId]!.formula} ${c.units}`).join(' + ');
}
