import { useState } from 'react';
import type { Lot, TeamState } from '../../shared/types';
import { MATERIALS, PHASE_LABEL } from '../../shared/chemistry/materials';
import { PROCESSES, applicableProcesses, applyProcess, lotComponents } from '../../shared/chemistry/processes';
import { EQUIPMENT } from '../../shared/chemistry/equipment';
import { tagLabel, processEnergy, processFee } from '../../shared/engine/commands';
import { Formula, Mat, Modal, Tokens, EnergyIcon, CoinIcon } from './common';
import { ParticleView } from './Particles';
import { lotMassGrams } from '../../shared/engine/ledger';

/** 창고의 재료 한 묶음. 이름 먼저, 개수, 화학식은 작게. */
export function LotChip({ lot, selected, onClick }: { lot: Lot; selected?: boolean; onClick: () => void }) {
  const comps = lotComponents(lot);
  const needsSort = lot.kind === 'mixture' || (lot.kind === 'pure' && lot.materialId === 'H2O_g');
  return (
    <button className={`lot ${lot.kind === 'mixture' ? 'mix' : ''} ${selected ? 'sel' : ''}`} onClick={onClick} aria-label={`창고 ${comps.map((c) => `${MATERIALS[c.materialId]!.displayName} ${c.units}개`).join(', ')}`}>
      {lot.kind === 'pure' ? (
        <>
          <span className="lname"><Mat id={lot.materialId!} count={lot.units} /></span>
          <Tokens materialId={lot.materialId!} units={lot.units} />
          <span className="lmeta">{lot.tags.map((t) => <span key={t} className={`tag ${lot.grade === 'purchased' ? '' : 'tag-teal'}`} style={{ padding: '0 5px' }}>{tagLabel(t)}</span>)}{needsSort && <span className="tag tag-amber" style={{ padding: '0 5px' }}>응축하기 필요</span>}</span>
        </>
      ) : (
        <>
          <span className="lname">섞인 것 <span className="muted small">{lot.tags.includes('gasMixture') ? '(기체)' : lot.tags.includes('suspension') ? '(고체+용액)' : '(액체)'}</span></span>
          <span className="lmeta">{comps.map((c) => <span key={c.materialId} className="tag tag-copper" style={{ padding: '0 5px' }}>{MATERIALS[c.materialId]!.displayName} {c.units}</span>)}</span>
          <span className="tag tag-amber" style={{ padding: '0 5px' }}>정리하기 필요</span>
        </>
      )}
    </button>
  );
}

export function LotDetail({ lot, team, canAct, onProcess, onClose }: { lot: Lot; team: TeamState; canAct: boolean; onProcess: (pid: string) => void; onClose: () => void }) {
  const comps = lotComponents(lot);
  const procs = applicableProcesses(lot);
  const [preview, setPreview] = useState<string | null>(null);
  return (
    <Modal title={lot.kind === 'pure' ? <Mat id={lot.materialId!} count={lot.units} /> : '섞인 것'} onClose={onClose}>
      <div className="stack">
        <div className="particles">{comps.map((c) => <ParticleView key={c.materialId} materialId={c.materialId} count={c.units} />)}</div>
        <div className="row">
          {comps.map((c) => { const m = MATERIALS[c.materialId]!; return <span key={c.materialId} className="tag tag-teal">{m.displayName} · {PHASE_LABEL[m.phase]} · {m.compositionClass === 'element' ? '홑원소 물질' : m.compositionClass === 'compound' ? '화합물' : '혼합물'} · {m.structureClass === 'ionic' ? '이온 결합' : m.structureClass === 'molecular' ? '분자' : m.structureClass === 'metallic' ? '금속' : '그물 구조'}</span>; })}
        </div>
        <p className="small">{comps.map((c) => MATERIALS[c.materialId]!.blurb).join(' ')}</p>
        <p className="muted small">어디서 왔나: {lot.origin.type === 'purchase' ? '가게에서 삼' : lot.origin.type === 'bundle' ? '시작 재료' : lot.origin.chain.map((x) => (x.startsWith('R') ? '만들기' : PROCESSES[x]?.name ?? x)).join(' → ')} · {lot.tags.map(tagLabel).join(', ')} · 무게 약 {lotMassGrams(lot)} g{lot.solvent > 0 ? ` · 함께 있는 물 ${lot.solvent} (팔 수 없는 공정 용수)` : ''}</p>
        {lot.grade === 'purchased' && <p className="small" style={{ background: 'var(--amber-soft)', padding: 8, borderRadius: 8 }}>가게에서 산 재료는 그대로 배달할 수 없어요. 만들기나 정리하기를 거쳐야 해요.</p>}
        <div className="divider" />
        <div className="card-title">정리하기 (기다림 없이 바로 창고에 들어와요)</div>
        {procs.length === 0 && <p className="muted small">이 재료는 정리할 것이 없어요. 만들기 카드의 재료로 쓰거나, 배달 조건에 맞으면 배달하세요.</p>}
        <div className="stack">
          {procs.map((pid) => {
            const p = PROCESSES[pid]!;
            const owns = !p.requiredEquipment || team.equipment.some((e) => e.id === p.requiredEquipment);
            const res = applyProcess(pid, lot, () => 'preview');
            const energy = processEnergy(team, pid);
            const fee = processFee(team, pid);
            return (
              <div key={pid} className="card" style={{ padding: 10 }}>
                <div className="row-between">
                  <div><b>{p.name}</b> <span className="muted small">{p.description}</span></div>
                  <div className="row"><span className="tag"><EnergyIcon size={12} /> {energy}</span><span className="tag"><CoinIcon size={12} /> {fee}</span></div>
                </div>
                {res.ok && <div className="small" style={{ marginTop: 4 }}>결과: {res.outputs.map((o) => lotComponents(o).map((c) => `${MATERIALS[c.materialId]!.displayName} ${c.units}개`).join('+') + ` (${o.tags.map(tagLabel).join('/')})`).join(' · ')}{res.solventReleased ? ` · 회수수 ${res.solventReleased}` : ''}</div>}
                {!owns && <div className="small" style={{ color: 'var(--danger)' }}>장비 필요: {EQUIPMENT[p.requiredEquipment!]!.name}</div>}
                <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => setPreview(preview === pid ? null : pid)}>{preview === pid ? '그림 닫기' : '그림으로 보기'}</button>
                  {canAct ? <button className="btn btn-sm btn-primary" disabled={!owns || team.energy < energy || team.coins - team.bid < fee} onClick={() => onProcess(pid)}>{p.name} (행동 1)</button> : <span className="muted small">차례인 사람만 할 수 있어요</span>}
                </div>
                {preview === pid && res.ok && <div className="particles" style={{ marginTop: 6 }}>{res.outputs.flatMap((o) => lotComponents(o).map((c) => <ParticleView key={o.id + c.materialId} materialId={c.materialId} count={c.units} scale={0.7} />))}</div>}
              </div>
            );
          })}
        </div>
        <p className="muted small"><Formula id={comps[0]!.materialId} /></p>
      </div>
    </Modal>
  );
}
