import type { GameView } from '../../shared/protocol';
import type { TeamState } from '../../shared/types';
import { REACTIONS } from '../../shared/chemistry/reactions';
import { MATERIALS } from '../../shared/chemistry/materials';
import { EQUIPMENT } from '../../shared/chemistry/equipment';
import { massRatio } from '../../shared/chemistry/atoms';
import { Formula, Equation, Mat, Modal, EnergyIcon } from './common';
import { ParticleView } from './Particles';
import { lotComponents } from '../../shared/chemistry/processes';

function stockOf(team: TeamState, ids: string[]): number {
  let n = 0;
  for (const l of team.lots) if (l.kind === 'pure' && ids.includes(l.materialId!)) n += l.units;
  return n;
}

export type ReactionReason = '' | '재료 부족' | '작업 자리 없음' | '에너지 부족' | '장비 필요';

export function reactionStatus(team: TeamState, rid: string, game: GameView): { canRun: boolean; reason: ReactionReason; detail: string; scaleMax: 0 | 1 | 2; energy: number; time: number } {
  const r = REACTIONS[rid]!;
  const owns = (e: string) => team.equipment.some((x) => x.id === e);
  const missingEq = (r.requiredEquipment ?? []).filter((e) => !owns(e));
  const time = r.catalystEquipment && owns(r.catalystEquipment) && r.timeWithCatalyst !== undefined ? r.timeWithCatalyst : r.time;
  let scaleMax: 0 | 1 | 2 = 2;
  const missing: string[] = [];
  for (const s of r.reactants) {
    const have = stockOf(team, s.accepts);
    const per = s.coef * r.batchMultiplier;
    if (have < per) { scaleMax = 0; missing.push(`${MATERIALS[s.accepts[0]!]!.displayName} ${per - have}개`); }
    else if (have < per * 2 && scaleMax === 2) scaleMax = 1;
  }
  if (missingEq.length) return { canRun: false, reason: '장비 필요', detail: missingEq.map((e) => EQUIPMENT[e]!.name).join(', '), scaleMax: 0, energy: r.energy, time };
  if (scaleMax === 0) return { canRun: false, reason: '재료 부족', detail: missing.join(', '), scaleMax, energy: r.energy, time };
  if (team.energy < r.energy) return { canRun: false, reason: '에너지 부족', detail: `${r.energy} 필요`, scaleMax, energy: r.energy, time };
  const running = team.processes.filter((p) => p.kind === 'reaction').length;
  const slots = 2 + (owns('U01') ? 1 : 0);
  if (running >= slots) return { canRun: false, reason: '작업 자리 없음', detail: '라운드가 끝나면 비어요', scaleMax, energy: r.energy, time };
  void game;
  return { canRun: true, reason: '', detail: '', scaleMax, energy: r.energy, time };
}

/** 만들기 카드: 물질 이름 먼저, 화학식은 작게. */
export function ReactionCard({ rid, team, game, pinned, onOpen }: { rid: string; team: TeamState; game: GameView; pinned: number; onOpen: () => void }) {
  const r = REACTIONS[rid]!;
  const st = reactionStatus(team, rid, game);
  const prodMult = r.extentModel.type === 'partial' ? r.extentModel.extent : r.batchMultiplier;
  return (
    <button className={`rcard ${st.canRun ? 'ready' : ''} ${st.reason === '장비 필요' ? 'locked' : ''}`} onClick={onOpen} aria-label={`${r.name} 만들기 카드`}>
      {pinned > 0 && <span className="pinmark">추천 {pinned}</span>}
      <span className="rname">{r.name}</span>
      <span className="recipe">
        {r.reactants.map((s, i) => <span key={i} className={`ing ${stockOf(team, s.accepts) >= s.coef * r.batchMultiplier ? 'have' : 'need'}`}>{MATERIALS[s.accepts[0]!]!.displayName} ×{s.coef * r.batchMultiplier}</span>)}
        <span className="arrow-s">→</span>
        {r.products.map((p, i) => <span key={i} className="ing out">{MATERIALS[p.materialId]!.displayName} ×{p.coef * prodMult}</span>)}
      </span>
      <Equation text={r.equation} className="eq-small" />
      <span className="cost"><span><EnergyIcon size={13} /> {r.energy}</span><span>⏱ {st.time}라운드</span>{r.exothermic && <span title="열이 나는 반응">🔥</span>}{r.extentModel.type === 'partial' && <span className="tag tag-amber">일부만 반응</span>}</span>
      {st.canRun ? <span className="tag tag-teal">지금 만들 수 있어요</span> : <span className="tag">{st.reason}{st.detail ? `: ${st.detail}` : ''}</span>}
    </button>
  );
}

export function ReactionDetail({ rid, team, game, canAct, onRun, onPin, onClose }: { rid: string; team: TeamState; game: GameView; canAct: boolean; onRun: (scale: 1 | 2) => void; onPin: () => void; onClose: () => void }) {
  const r = REACTIONS[rid]!;
  const st = reactionStatus(team, rid, game);
  const owns = (e: string) => team.equipment.some((x) => x.id === e);
  return (
    <Modal title={<span>{r.name} <span className="muted small">{r.id}</span></span>} onClose={onClose} wide>
      <div className="stack">
        <div className="recipe-big">
          {r.reactants.map((s, i) => <Mat key={`r${i}`} id={s.accepts[0]!} count={s.coef * r.batchMultiplier} />)}
          <span className="arrow">→</span>
          {r.products.map((p, i) => <Mat key={`p${i}`} id={p.materialId} count={p.coef * (r.extentModel.type === 'partial' ? r.extentModel.extent : r.batchMultiplier)} />)}
        </div>
        <Equation text={r.equation} className="eq-mid" />
        <p className="small muted">{r.conditions} · {r.handling}</p>
        <div className="row">
          <span className="tag"><EnergyIcon size={13} /> 에너지 {r.energy} (1회)</span>
          <span className="tag">⏱ {st.time}라운드 뒤 완성{r.catalystEquipment && r.timeWithCatalyst !== undefined && (owns(r.catalystEquipment) ? ' (촉매 적용)' : ` · ${EQUIPMENT[r.catalystEquipment]!.name}이 있으면 ${r.timeWithCatalyst}라운드`)}</span>
          {r.exothermic ? <span className="tag tag-copper">열이 나는 반응{r.heatRecoverable ? ' · 열회수 가능' : ''}</span> : <span className="tag tag-teal">열을 넣어야 하는 반응</span>}
          {r.requiredEquipment?.map((e) => <span key={e} className={`tag ${owns(e) ? 'tag-teal' : 'tag-danger'}`}>{EQUIPMENT[e]!.name} {owns(e) ? '있음' : '필요'}</span>)}
        </div>
        <BatchPreview rid={rid} team={team} />
        <WhyThisMuch rid={rid} />
        {r.extentModel.type === 'partial' && <p className="small" style={{ background: 'var(--amber-soft)', padding: 8, borderRadius: 8 }}>{r.extentModel.note}</p>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
          <button className="btn btn-ghost" onClick={onPin}>👍 팀원에게 추천</button>
          {canAct ? (
            <>
              <button className="btn btn-primary" disabled={!st.canRun || st.scaleMax < 1} onClick={() => onRun(1)}>만들기 ×1</button>
              <button className="btn btn-copper" disabled={!st.canRun || st.scaleMax < 2 || team.energy < r.energy * 2} onClick={() => onRun(2)}>두 배로 만들기 ×2</button>
            </>
          ) : <span className="muted small">{st.canRun ? '차례인 사람만 만들 수 있어요' : `${st.reason}${st.detail ? ': ' + st.detail : ''}`}</span>}
        </div>
      </div>
    </Modal>
  );
}

function BatchPreview({ rid, team }: { rid: string; team: TeamState }) {
  const r = REACTIONS[rid]!;
  return (
    <div className="card" style={{ padding: 10 }}>
      <div className="card-title">한 번 만들 때 (×1)</div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="stack">{r.reactants.map((s, i) => { const need = s.coef * r.batchMultiplier; const have = stockOf(team, s.accepts); return <span key={i} className={`tag ${have >= need ? 'tag-teal' : 'tag-danger'}`}>{MATERIALS[s.accepts[0]!]!.displayName} {need}개 필요 (창고에 {have}개){s.dissolve ? ' · 물에 녹여 넣음' : ''}</span>; })}</div>
        <span className="arrow">→</span>
        <div className="stack">{r.outputs.map((s, i) => <span key={i} className={`tag ${s.mixture ? 'tag-copper' : 'tag-teal'}`}>{s.mixture ? '섞여서 나옴: ' : ''}{s.products.map((p) => `${MATERIALS[p.materialId]!.displayName} ${p.coef}개`).join(' + ')}{s.mixture ? ' → 정리하기 필요' : s.products.some((p) => p.materialId === 'H2O_g') ? ' → 응축하기 필요' : ''}</span>)}</div>
      </div>
    </div>
  );
}

/** '왜 이만큼?' — 원자 수 · 질량 · 기체 부피비 */
export function WhyThisMuch({ rid }: { rid: string }) {
  const r = REACTIONS[rid]!;
  return (
    <details className="card" style={{ padding: 10 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--teal)' }}>왜 이만큼 필요할까? — 원자 · 질량 · 기체 부피</summary>
      <div className="stack" style={{ marginTop: 8 }}>
        <div className="particles">
          {r.reactants.map((s, i) => <ParticleView key={`r${i}`} materialId={s.accepts[0]!} count={s.coef} />)}
          <span className="arrow">→</span>
          {r.products.map((p, i) => <ParticleView key={`p${i}`} materialId={p.materialId} count={p.coef} />)}
        </div>
        <p className="small">반응 전과 후에 원자의 수는 같아요 ({elementSummary(rid)}). 그래서 재료 비율이 정해져 있어요.</p>
        <table className="small" style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr><th style={{ textAlign: 'left' }}>물질</th><th>개수(계수)</th><th>1몰 질량(g)</th><th>질량 합</th><th>원소 질량비</th></tr></thead>
          <tbody>
            {[...r.reactants.map((s) => ({ id: s.accepts[0]!, coef: s.coef })), ...r.products.map((p) => ({ id: p.materialId, coef: p.coef }))].map((x, i) => {
              const m = MATERIALS[x.id]!;
              return <tr key={i} style={{ borderTop: '1px solid var(--ivory-3)' }}><td>{m.displayName} <Formula id={x.id} /></td><td className="center">{x.coef}</td><td className="center">{m.molarMass}</td><td className="center">{Math.round(x.coef * m.molarMass * 100) / 100}</td><td className="center">{massRatio(m.composition).map((e) => `${e.element} ${e.percent}%`).join(' · ')}</td></tr>;
            })}
          </tbody>
        </table>
        <p className="small muted">질량 보존: 재료의 질량 합 = 만들어진 것의 질량 합 (원자량 H=1, C=12, N=14, O=16 …). 게임의 1개 = 0.1 mol.</p>
        {r.gasVolumeRatio ? <p className="small"><b>기체 부피비</b> {r.gasVolumeRatio.label} = {r.gasVolumeRatio.ratio}. {r.gasVolumeRatio.note}</p> : <p className="small muted">기체 부피비는 같은 온도·압력의 기체끼리만 비교해요. 이 반응에는 표시하지 않아요.</p>}
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
  return lotComponents(lot as never).map((c) => `${MATERIALS[c.materialId]!.displayName} ${c.units}`).join(' + ');
}
