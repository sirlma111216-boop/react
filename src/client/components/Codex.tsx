import { useState } from 'react';
import { REACTIONS, heatLabel } from '../../shared/chemistry/reactions';
import { MODES } from '../../shared/chemistry/modes';
import { DEFAULT_ECONOMY } from '../../shared/config/economy';
import { MATERIALS, PHASE_LABEL } from '../../shared/chemistry/materials';
import { CONTRACTS, CATEGORY_LABEL } from '../../shared/chemistry/contracts';
import { EQUIPMENT } from '../../shared/chemistry/equipment';
import { PROCESSES } from '../../shared/chemistry/processes';
import { Modal, Formula, Equation, AssetImage } from './common';
import { WhyThisMuch } from './ReactionCard';
import { ParticleView } from './Particles';
import { MaterialArt } from './Art';
import { massRatio, ionText, subscriptFormula } from '../../shared/chemistry/atoms';

const modeNames = (ids: string[]) => ids.map((id) => MODES[id as keyof typeof MODES]?.name ?? id).join(' · ');
import { tagLabel } from '../../shared/engine/commands';

type Tab = 'reactions' | 'materials' | 'contracts' | 'equipment' | 'rules';

/** 도감: 보드에서 여는 얕은 패널. 전체 반응 22개와 물질·계약·설비를 볼 수 있다. */
export function Codex({ activeReactions, onClose }: { activeReactions?: string[]; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('reactions');
  const [sel, setSel] = useState<string>('R01');
  const list = tab === 'reactions' ? Object.keys(REACTIONS) : tab === 'materials' ? Object.keys(MATERIALS) : tab === 'contracts' ? Object.keys(CONTRACTS) : tab === 'equipment' ? Object.keys(EQUIPMENT) : [];
  const label = (id: string) => tab === 'reactions' ? `${id} ${REACTIONS[id]!.name}` : tab === 'materials' ? `${MATERIALS[id]!.displayName} ${subscriptFormula(MATERIALS[id]!.formula)}` : tab === 'contracts' ? `${id} ${CONTRACTS[id]!.title}` : `${id} ${EQUIPMENT[id]!.name}`;
  const selected = list.includes(sel) ? sel : list[0] ?? '';
  return (
    <Modal title="도감" onClose={onClose} wide>
      <div className="tabs">
        {(['reactions', 'materials', 'contracts', 'equipment', 'rules'] as Tab[]).map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => { setTab(t); setSel(''); }}>{{ reactions: '만들기 카드', materials: '물질', contracts: '의뢰', equipment: '장비', rules: '규칙' }[t]}</button>)}
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
      <h3 style={{ color: 'var(--teal)' }}>{r.name} <span className="muted small">{modeNames(r.modes)}</span></h3>
      <Equation text={r.equation} className="eq-mid" />
      <p className="small">{r.conditions}. {r.handling}</p>
      <div className="row"><span className="tag">에너지 {r.energy}</span><span className="tag">{r.time}라운드 뒤 완성{r.timeWithCatalyst !== undefined ? ` (촉매 있으면 ${r.timeWithCatalyst})` : ''}</span><span className="tag">{heatLabel(r)}</span>{r.requiredEquipment?.map((e) => <span key={e} className="tag tag-copper">{EQUIPMENT[e]!.name} 필요</span>)}</div>
      <WhyThisMuch rid={id} />
      {r.simplifications.length > 0 && <p className="muted small">단순화: {r.simplifications.join(' ')}</p>}
    </div>
  );
}

function MaterialEntry({ id }: { id: string }) {
  const m = MATERIALS[id]!;
  return (
    <div className="stack">
      <h3 style={{ color: 'var(--teal)', display: 'flex', alignItems: 'center', gap: 10 }}><MaterialArt materialId={id} size={72} showPhase /> <span><Formula id={id} /> {m.displayName}</span></h3>
      <p className="small muted">그림은 보관 용기예요. 용기 색은 물질의 실제 색이 아니고, 그림 속 알갱이 수는 개수가 아니에요.</p>
      <div className="particles"><ParticleView materialId={id} count={1} scale={1.1} /></div>
      <div className="row"><span className="tag">{PHASE_LABEL[m.phase]}</span><span className="tag">{m.compositionClass === 'element' ? '홑원소 물질' : '화합물'}</span><span className="tag">{m.structureClass === 'ionic' ? (m.phase === 'aq' ? '물에 녹아 이온으로 나뉨' : '이온으로 이루어짐') : m.structureClass === 'molecular' ? (m.ions && m.phase === 'aq' ? '분자 (물에서 이온으로 나뉨)' : '분자로 이루어짐') : m.structureClass === 'metallic' ? '금속' : '그물 구조'}</span><span className="tag">몰질량 {m.molarMass} g/mol</span></div>
      {m.ions && <p className="small">{m.structureClass === 'ionic' ? '이온 구성' : '물에 녹으면 나뉘는 이온'}: {m.ions.map((i) => `${ionText(i)} ${i.count}개`).join(', ')} (+전하와 −전하를 더하면 0)</p>}
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
      <h3 style={{ color: 'var(--teal)' }}>{c.title} <span className="muted small">{CATEGORY_LABEL[c.category]}</span></h3>
      <AssetImage id={c.imageId} alt={CATEGORY_LABEL[c.category]} style={{ width: 160, height: 160, borderRadius: 14, objectFit: 'cover' }} fallback={<div style={{ width: 160, height: 160, borderRadius: 14, background: 'var(--ivory-2)' }} />} />
      <p className="small">{c.blurb}</p>
      <div className="row">{c.requirements.map((r, i) => <span key={i} className="tag tag-teal">{MATERIALS[r.materialId]!.displayName} <Formula id={r.materialId} /> {r.units}개 · {r.tags.map(tagLabel).join('/')}</span>)}</div>
      <p className="small">기본 보상 {DEFAULT_ECONOMY.contractRewards[c.id] ?? c.reward}코인 (배달할 때 시세에 따라 최대 ±8% 달라져요) · {modeNames(c.modes)}{c.byproductOnly ? ' · 함께 생긴 것으로 채우는 의뢰(게임당 최대 2번)' : ''}</p>
    </div>
  );
}

function EquipmentEntry({ id }: { id: string }) {
  const e = EQUIPMENT[id]!;
  return (
    <div className="stack">
      <h3 style={{ color: 'var(--teal)' }}>{e.name} </h3>
      <AssetImage id={e.imageId} alt={e.name} style={{ width: 160, height: 160, objectFit: 'contain' }} fallback={<div style={{ width: 160, height: 160, borderRadius: 14, background: 'var(--ivory-2)' }} />} />
      <p className="small">{e.effect}</p>
      <p className="small">가격 {DEFAULT_ECONOMY.equipmentPrices[e.id] ?? e.price}코인 · {modeNames(e.modes)}{e.leasable ? ' · 산업 공방에서는 시작할 때 하나를 무료로 빌릴 수 있음' : ''}</p>
    </div>
  );
}

function Rules() {
  return (
    <div className="stack small" style={{ maxHeight: '60vh', overflow: 'auto' }}>
      <h3>1분 설명</h3>
      <p>우리 팀은 작은 <b>화학 공방</b>이에요. <b>재료를 사고</b>, <b>만들기 카드로 만들고</b>, <b>정리해서</b>, <b>도시의 의뢰에 배달</b>해요. 필요하면 <b>장비</b>를 사서 더 빠르고 싸게 만들어요. 마지막에 코인(+ 산 장비 값의 절반)이 가장 많은 팀이 이겨요.</p>
      <h3>라운드</h3>
      <p>제한시간은 없어요. 차례인 사람이 네 장소(의뢰소·공방·상점·출하장)를 오가며 3번 행동하고 <b>준비 완료</b>를 누르면, 모든 팀이 준비됐을 때 라운드가 마무리돼요(완성품 도착·시세 변화·차례 교대). 다른 팀원은 카드를 보고 👍 추천으로 도와요.</p>
      <h3>길드 연구지원품</h3>
      <p>라운드마다 공방에 세 묶음(완성 소재 1개 · 공정 재료 3~4개 · 기초 원료 8~10개)이 도착해요. 차례인 사람이 <b>1묶음을 통째로 반송</b>하고 나머지 <b>2묶음</b>을 받아요. 고르기 전에는 사기·만들기·준비 완료가 잠기고, 행동력·코인은 들지 않아요. 팀원은 '반송 제안'으로 도와요. 완성 소재는 조건에 '지원 완성 소재 가능'이라고 적힌 의뢰에만 보탤 수 있어요.</p>
      <h3>재고 매입</h3>
      <p>상점의 '재고 매입'에서 남는 순물질을 <b>구입가보다 낮은 값</b>에 넘길 수 있어요. 라운드에 한 번, 라운드 5코인·경기 20코인(10라운드 기준) 한도가 있고 행동력은 들지 않아요. 섞인 것은 먼저 정리해야 해요. 게임이 끝날 때 남은 재고는 점수에 더하지도 빼지도 않아요.</p>
      <h3>개수</h3>
      <p>게임의 1개 = 0.1 mol. 만들기 카드가 재료 비율을 보여주고 필요한 양을 계산해 줘요. 원자는 사라지거나 생기지 않고(질량 보존), 섞여 나온 것은 정리해야 배달할 수 있어요. 상점에서 산 재료는 그대로 배달할 수 없어요.</p>
      <h3>의뢰·시세·입찰</h3>
      <p>의뢰는 팀당 2개까지. 배달할 때 받는 돈은 <b>기본금 ± 시세</b>(카테고리별, 최대 ±8%)이고 시세는 라운드가 바뀔 때만 움직여요. 지금 팔지, 다음 라운드에 팔지 고를 수 있어요. 3·6라운드에는 도시 특별 의뢰에 0~6코인을 몰래 써내서 가져가요(마무리 때 공개, 같은 금액이면 미리 정해진 순서).</p>
      <h3>정리하기</h3>
      <ul>{Object.values(PROCESSES).map((p) => <li key={p.id}><b>{p.name}</b> (에너지 {p.energy}, 수수료 {p.fee}, 바로 완료): {p.description}</li>)}</ul>
      <h3>없는 것</h3>
      <p>퀴즈·정답 입력·개인 성적표·개인 순위는 없어요. 파산·창고 파괴·상대 방해 카드도 없어요.</p>
    </div>
  );
}
