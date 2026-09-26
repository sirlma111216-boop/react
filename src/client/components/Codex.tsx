import { useState } from 'react';
import { REACTIONS } from '../../shared/chemistry/reactions';
import { MATERIALS, PHASE_LABEL } from '../../shared/chemistry/materials';
import { CONTRACTS, CATEGORY_LABEL } from '../../shared/chemistry/contracts';
import { EQUIPMENT } from '../../shared/chemistry/equipment';
import { PROCESSES } from '../../shared/chemistry/processes';
import { Modal, Formula, Equation, AssetImage } from './common';
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
        {(['reactions', 'materials', 'contracts', 'equipment', 'rules'] as Tab[]).map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => { setTab(t); setSel(''); }}>{{ reactions: '만들기 카드', materials: '물질', contracts: '주문', equipment: '장비', rules: '규칙' }[t]}</button>)}
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
      <Equation text={r.equation} className="eq-mid" />
      <p className="small">{r.conditions}. {r.handling}</p>
      <div className="row"><span className="tag">에너지 {r.energy}</span><span className="tag">{r.time}라운드 뒤 완성{r.timeWithCatalyst !== undefined ? ` (촉매 있으면 ${r.timeWithCatalyst})` : ''}</span><span className="tag">{r.exothermic ? '열이 나는 반응' : '열을 넣는 반응'}</span>{r.requiredEquipment?.map((e) => <span key={e} className="tag tag-copper">{EQUIPMENT[e]!.name} 필요</span>)}</div>
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
      <p className="muted small">게임의 1개 = 0.1 mol = {Math.round(m.molarMass * 10) / 100} g</p>
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
      <div className="row">{c.requirements.map((r, i) => <span key={i} className="tag tag-teal">{MATERIALS[r.materialId]!.displayName} <Formula id={r.materialId} /> {r.units}개 · {r.tags.map(tagLabel).join('/')}</span>)}</div>
      <p className="small">기본 보상 {c.reward}코인 (게임 안의 값이에요) · 모드 {c.modes.join('/')}{c.byproductOnly ? ' · 부산물 주문(게임당 최대 2회)' : ''}</p>
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
      <p className="small">기본 가격 {e.price}코인 · 모드 {e.modes.join('/')}{e.leasable ? ' · 산업 공방에서 무료로 빌릴 수 있음' : ''}</p>
    </div>
  );
}

function Rules() {
  return (
    <div className="stack small" style={{ maxHeight: '60vh', overflow: 'auto' }}>
      <h3>1분 설명</h3>
      <p>우리 팀은 작은 <b>화학 공방</b>이에요. <b>재료를 사고</b>, <b>만들기 카드로 만들고</b>, <b>정리해서</b>, <b>도시의 주문에 배달</b>해요. 필요하면 <b>장비</b>를 사서 더 빠르고 싸게 만들어요. 마지막에 코인(+ 산 장비 값의 절반)이 가장 많은 팀이 이겨요.</p>
      <h3>라운드</h3>
      <p>상의 시간 30초(주문 받기·입찰·의논) → 행동 시간 90초(차례인 사람이 3번 행동) → 마무리 30초(완성품 도착·다음 사람에게 인계). 라운드마다 팀 안에서 차례가 바뀌어요. 다른 팀원은 카드를 보고 👍 추천으로 도와요.</p>
      <h3>개수</h3>
      <p>게임의 1개 = 0.1 mol. 만들기 카드가 재료 비율을 보여주고 필요한 양을 계산해 줘요. 원자는 사라지거나 생기지 않고(질량 보존), 섞여 나온 것은 정리해야 배달할 수 있어요. 가게에서 산 재료는 그대로 배달할 수 없어요.</p>
      <h3>주문과 입찰</h3>
      <p>주문은 팀당 2개까지. 3·6라운드에 도시 특별 주문이 나오고 0~6코인을 몰래 써내서 가져가요. 행동 시간이 끝나면 공개되고, 같은 금액이면 미리 정해진 순서로 정해요.</p>
      <h3>정리하기</h3>
      <ul>{Object.values(PROCESSES).map((p) => <li key={p.id}><b>{p.name}</b> (에너지 {p.energy}, 수수료 {p.fee}, 바로 완료): {p.description}</li>)}</ul>
      <h3>없는 것</h3>
      <p>퀴즈·정답 입력·개인 성적표·개인 순위는 없어요. 파산·창고 파괴·상대 방해 카드도 없어요.</p>
    </div>
  );
}
