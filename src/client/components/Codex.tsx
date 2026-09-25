import { useState } from 'react';
import { REACTIONS } from '../../shared/chemistry/reactions';
import { MATERIALS, PHASE_LABEL } from '../../shared/chemistry/materials';
import { CONTRACTS, CATEGORY_LABEL } from '../../shared/chemistry/contracts';
import { EQUIPMENT } from '../../shared/chemistry/equipment';
import { PROCESSES } from '../../shared/chemistry/processes';
import { Modal, Formula, AssetImage } from './common';
import { WhyThisMuch } from './ReactionCard';
import { ParticleView } from './Particles';
import { massRatio } from '../../shared/chemistry/atoms';
import { tagLabel } from '../../shared/engine/commands';

type Tab = 'reactions' | 'materials' | 'contracts' | 'equipment' | 'rules';

/** 도감: 보드에서 여는 얕은 패널. 전체 반응 22개와 물질·계약·설비를 볼 수 있다. */
export function Codex({ activeReactions, onClose }: { activeReactions?: string[]; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('reactions');
  const [sel, setSel] = useState<string>('R01');
  const list = tab === 'reactions' ? Object.keys(REACTIONS) : tab === 'materials' ? Object.keys(MATERIALS) : tab === 'contracts' ? Object.keys(CONTRACTS) : tab === 'equipment' ? Object.keys(EQUIPMENT) : [];
  const label = (id: string) => tab === 'reactions' ? `${id} ${REACTIONS[id]!.name}` : tab === 'materials' ? `${MATERIALS[id]!.formula} ${MATERIALS[id]!.displayName}` : tab === 'contracts' ? `${id} ${CONTRACTS[id]!.title}` : `${id} ${EQUIPMENT[id]!.name}`;
  const selected = list.includes(sel) ? sel : list[0] ?? '';
  return (
    <Modal title="도감" onClose={onClose} wide>
      <div className="tabs">
        {(['reactions', 'materials', 'contracts', 'equipment', 'rules'] as Tab[]).map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => { setTab(t); setSel(''); }}>{{ reactions: '반응', materials: '물질', contracts: '계약', equipment: '설비', rules: '규칙' }[t]}</button>)}
      </div>
      {tab === 'rules' ? <Rules /> : (
        <div className="codex">
          <div className="codex-list">
            {list.map((id) => <button key={id} className={selected === id ? 'active' : ''} onClick={() => setSel(id)}>{label(id)}{tab === 'reactions' && activeReactions && !activeReactions.includes(id) ? <span className="muted small"> (이번 경기 미사용)</span> : null}</button>)}
          </div>
          <div className="scroll" style={{ maxHeight: '60vh' }}>
            {tab === 'reactions' && selected && <ReactionEntry id={selected} />}
            {tab === 'materials' && selected && <MaterialEntry id={selected} />}
            {tab === 'contracts' && selected && <ContractEntry id={selected} />}
            {tab === 'equipment' && selected && <EquipmentEntry id={selected} />}
          </div>
        </div>
      )}
    </Modal>
  );
}

function ReactionEntry({ id }: { id: string }) {
  const r = REACTIONS[id]!;
  return (
    <div className="stack">
      <h3 style={{ color: 'var(--teal)' }}>{r.name} <span className="muted small">{r.id} · {r.modes.join('/')}</span></h3>
      <div className="formula" style={{ fontSize: 17 }}>{r.equation}</div>
      <p className="small">{r.conditions}. {r.handling}</p>
      <div className="row"><span className="tag">에너지 {r.energy}</span><span className="tag">시간 {r.time}R{r.timeWithCatalyst !== undefined ? ` (촉매 ${r.timeWithCatalyst}R)` : ''}</span><span className="tag">{r.exothermic ? '발열' : '흡열'}</span>{r.requiredEquipment?.map((e) => <span key={e} className="tag tag-copper">{EQUIPMENT[e]!.name} 필요</span>)}</div>
      <WhyThisMuch rid={id} />
      {r.simplifications.length > 0 && <p className="muted small">단순화: {r.simplifications.join(' ')}</p>}
    </div>
  );
}

function MaterialEntry({ id }: { id: string }) {
  const m = MATERIALS[id]!;
  return (
    <div className="stack">
      <h3 style={{ color: 'var(--teal)' }}><Formula id={id} /> {m.displayName}</h3>
      <div className="particles"><ParticleView materialId={id} count={1} scale={1.1} /></div>
      <div className="row"><span className="tag">{PHASE_LABEL[m.phase]}</span><span className="tag">{m.compositionClass === 'element' ? '홑원소 물질' : '화합물'}</span><span className="tag">{m.structureClass === 'ionic' ? '이온성' : m.structureClass === 'molecular' ? '분자성' : m.structureClass === 'metallic' ? '금속성' : '그물 구조'}</span><span className="tag">몰질량 {m.molarMass} g/mol</span></div>
      {m.ions && <p className="small">이온 구성: {m.ions.map((i) => `${i.formula} × ${i.count}`).join(', ')} (formula unit 기준, 총전하 {m.charge})</p>}
      <p className="small">원소 질량비(일정 성분비): {massRatio(m.composition).map((e) => `${e.element} ${e.mass}(${e.percent}%)`).join(' : ')}</p>
      <p className="small">{m.blurb}</p>
      <p className="muted small">1칸 = 0.1 mol = {Math.round(m.molarMass * 10) / 100} g</p>
    </div>
  );
}

function ContractEntry({ id }: { id: string }) {
  const c = CONTRACTS[id]!;
  return (
    <div className="stack">
      <h3 style={{ color: 'var(--teal)' }}>{c.title} <span className="muted small">{c.id} · {CATEGORY_LABEL[c.category]}</span></h3>
      <AssetImage id={c.imageId} alt={CATEGORY_LABEL[c.category]} style={{ width: 160, height: 160, borderRadius: 14, objectFit: 'cover' }} fallback={<div style={{ width: 160, height: 160, borderRadius: 14, background: 'var(--ivory-2)' }} />} />
      <p className="small">{c.blurb}</p>
      <div className="row">{c.requirements.map((r, i) => <span key={i} className="tag tag-teal"><Formula id={r.materialId} /> {r.units}칸 · 이력 {r.tags.map(tagLabel).join('/')}</span>)}</div>
      <p className="small">기본 보상 {c.reward}코인 (게임 보상이며 시세가 아님) · 최소 {c.minRounds}라운드 · 모드 {c.modes.join('/')}{c.byproductOnly ? ' · 부산물 단독 계약(경기당 최대 2회)' : ''}</p>
    </div>
  );
}

function EquipmentEntry({ id }: { id: string }) {
  const e = EQUIPMENT[id]!;
  return (
    <div className="stack">
      <h3 style={{ color: 'var(--teal)' }}>{e.name} <span className="muted small">{e.id}</span></h3>
      <AssetImage id={e.imageId} alt={e.name} style={{ width: 160, height: 160, objectFit: 'contain' }} fallback={<div style={{ width: 160, height: 160, borderRadius: 14, background: 'var(--ivory-2)' }} />} />
      <p className="small">{e.effect}</p>
      <p className="small">기본 가격 {e.price}코인 · 모드 {e.modes.join('/')}{e.leasable ? ' · 산업 공방 무료 임대 후보' : ''}</p>
    </div>
  );
}

function Rules() {
  return (
    <div className="stack small" style={{ maxHeight: '60vh', overflow: 'auto' }}>
      <h3>90초 설명</h3>
      <p>작은 화학 공방을 운영하는 길드가 <b>원료를 사고(조달)</b>, <b>반응 카드를 실행해(생산)</b>, <b>가공으로 제품을 분리하고(가공)</b>, <b>도시의 주문에 납품(납품)</b>합니다. 필요하면 <b>설비</b>를 사서 공정을 빠르고 싸게 만듭니다. 최종 자산(코인 + 유료 설비 잔존가치 50%)이 가장 높은 길드가 승리합니다.</p>
      <h3>라운드</h3>
      <p>계획 30초(계약 확보·입찰·상의) → 실행 90초(담당자가 행동 2개) → 정산 30초(공정 완료·인계). 매 라운드 팀 안에서 조작 담당자가 바뀝니다. 다른 팀원은 카드를 살펴보고 핑으로 제안합니다.</p>
      <h3>재고 단위</h3>
      <p>1칸 = 0.1 mol. 반응 카드가 비율을 보여주고 필요한 양을 자동 계산합니다. 질량 보존·일정 성분비·기체 반응 법칙을 지키며, 혼합물은 가공으로 분리해야 납품할 수 있습니다. 상점에서 산 물질은 그대로 납품할 수 없습니다(생산 이력 필요).</p>
      <h3>계약과 입찰</h3>
      <p>계약은 팀당 2건까지. 3·6라운드에 도시 특별 계약이 공개되고 0~6코인의 비공개 동시 입찰로 수주합니다. 실행 단계 마감에 개봉하며, 동률은 서버 시드의 순환 우선순위로 정합니다.</p>
      <h3>가공 카드</h3>
      <ul>{Object.values(PROCESSES).map((p) => <li key={p.id}><b>{p.name}</b> (에너지 {p.energy}, 수수료 {p.fee}, {p.time}R): {p.description}</li>)}</ul>
      <h3>하지 않는 것</h3>
      <p>퀴즈·정답 입력·학생별 성적표·개인 순위는 없습니다. 파산·재고 파괴·상대 방해 카드도 없습니다.</p>
    </div>
  );
}
