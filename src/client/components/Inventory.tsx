import { useState } from 'react';
import type { Lot, TeamState } from '../../shared/types';
import { MATERIALS, PHASE_LABEL } from '../../shared/chemistry/materials';
import { PROCESSES, applicableProcesses, applyProcess, lotComponents } from '../../shared/chemistry/processes';
import { EQUIPMENT } from '../../shared/chemistry/equipment';
import { tagLabel, processEnergy, processFee } from '../../shared/engine/commands';
import { Formula, Modal, Tokens, EnergyIcon, CoinIcon } from './common';
import { ParticleView } from './Particles';
import { lotMassGrams } from '../../shared/engine/ledger';

export function LotChip({ lot, selected, onClick }: { lot: Lot; selected?: boolean; onClick: () => void }) {
  const comps = lotComponents(lot);
  return (
    <button className={`lot ${lot.kind === 'mixture' ? 'mix' : ''} ${selected ? 'sel' : ''}`} onClick={onClick} aria-label={`재고 ${comps.map((c) => `${MATERIALS[c.materialId]!.displayName} ${c.units}칸`).join(', ')}`}>
      {lot.kind === 'pure' ? (
        <>
          <span className="lname"><Formula id={lot.materialId!} /> <span className="units">{lot.units}</span>칸</span>
          <Tokens materialId={lot.materialId!} units={lot.units} />
          <span className="lmeta">{lot.tags.map((t) => <span key={t} className={`tag ${lot.grade === 'purchased' ? '' : 'tag-teal'}`} style={{ padding: '0 5px' }}>{tagLabel(t)}</span>)}{lot.solvent > 0 && <span className="tag" style={{ padding: '0 5px' }}>용매 {lot.solvent}</span>}</span>
        </>
      ) : (
        <>
          <span className="lname">혼합물 {lot.tags.includes('gasMixture') ? '(기체)' : lot.tags.includes('suspension') ? '(현탁액)' : '(액체)'}</span>
          <span className="lmeta">{comps.map((c) => <span key={c.materialId} className="tag tag-copper" style={{ padding: '0 5px' }}><Formula id={c.materialId} withPhase={false} /> {c.units}</span>)}{lot.solvent > 0 && <span className="tag" style={{ padding: '0 5px' }}>용매 {lot.solvent}</span>}</span>
          <span className="muted small">가공 필요 · {lot.origin.reactionId}</span>
        </>
      )}
    </button>
  );
}

export function LotDetail({ lot, team, canAct, onProcess, onClose }: { lot: Lot; team: TeamState; canAct: boolean; onProcess: (pid: string) => void; onClose: () => void }) {
  const comps = lotComponents(lot);
  const procs = applicableProcesses(lot);
  const [preview, setPreview] = useState<string | null>(null);
  const busy = team.processes.some((p) => p.kind === 'process');
  return (
    <Modal title={lot.kind === 'pure' ? <span><Formula id={lot.materialId!} /> {lot.units}칸</span> : '혼합물 로트'} onClose={onClose}>
      <div className="stack">
        <div className="particles">{comps.map((c) => <ParticleView key={c.materialId} materialId={c.materialId} count={c.units} />)}</div>
        <div className="row">
          {comps.map((c) => { const m = MATERIALS[c.materialId]!; return <span key={c.materialId} className="tag tag-teal">{m.displayName} · {PHASE_LABEL[m.phase]} · {m.compositionClass === 'element' ? '홑원소' : m.compositionClass === 'compound' ? '화합물' : '혼합물'} · {m.structureClass === 'ionic' ? '이온성' : m.structureClass === 'molecular' ? '분자성' : m.structureClass === 'metallic' ? '금속' : '그물'}</span>; })}
        </div>
        <p className="small">{comps.map((c) => MATERIALS[c.materialId]!.blurb).join(' ')}</p>
        <p className="muted small">이력: {lot.origin.type === 'purchase' ? '상점 구매' : lot.origin.type === 'bundle' ? '시작 묶음' : lot.origin.chain.join(' → ')} · 등급: {tagLabel(lot.grade)} · 태그: {lot.tags.map(tagLabel).join(', ')} · 질량 약 {lotMassGrams(lot)} g{lot.solvent > 0 ? ` · 운반 용매 ${lot.solvent}칸 (판매 불가한 공정 용수)` : ''}</p>
        {lot.grade === 'purchased' && <p className="small" style={{ background: 'var(--amber-soft)', padding: 8, borderRadius: 8 }}>상점에서 산 물질은 그대로 납품할 수 없습니다. 반응이나 지정 가공 이력이 필요합니다.</p>}
        <div className="divider" />
        <div className="card-title">가능한 가공</div>
        {procs.length === 0 && <p className="muted small">이 로트에 적용할 수 있는 가공이 없습니다. (정의되지 않은 조합은 이 공방에서 지원하지 않는 공정입니다.)</p>}
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
                  <div className="row"><span className="tag"><EnergyIcon size={12} /> {energy}</span><span className="tag"><CoinIcon size={12} /> {fee}</span><span className="tag">⏱ {p.time}R</span></div>
                </div>
                {res.ok && <div className="muted small" style={{ marginTop: 4 }}>결과: {res.outputs.map((o) => lotComponents(o).map((c) => `${MATERIALS[c.materialId]!.displayName} ${c.units}칸`).join('+') + ` [${o.tags.map(tagLabel).join('/')}]`).join(' · ')}{res.solventReleased ? ` · 회수수 ${res.solventReleased}칸` : ''}</div>}
                {!owns && <div className="small" style={{ color: 'var(--danger)' }}>필요 설비: {EQUIPMENT[p.requiredEquipment!]!.name}</div>}
                <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => setPreview(preview === pid ? null : pid)}>{preview === pid ? '미리보기 닫기' : '미리보기'}</button>
                  {canAct ? <button className="btn btn-sm btn-primary" disabled={!owns || busy || team.energy < energy || team.coins - team.bid < fee} onClick={() => onProcess(pid)}>{busy ? '가공대 사용 중' : '가공 실행'}</button> : <span className="muted small">담당자만 실행</span>}
                </div>
                {preview === pid && res.ok && <div className="particles" style={{ marginTop: 6 }}>{res.outputs.flatMap((o) => lotComponents(o).map((c) => <ParticleView key={o.id + c.materialId} materialId={c.materialId} count={c.units} scale={0.7} />))}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
