/**
 * V3 물질 아트 매핑. 이름이 아니라 안정된 materialId 로 그림을 연결한다.
 * 그림은 게임용 포장·보관 오브젝트일 뿐이다 — 이름·화학식·수량·상태·품질은 앱이 코드로 쓴다.
 * 파일: public/assets/objects/v3/<assetId>(-s|-l).webp  (원본: assets-source/v3/<assetId>.png, 저장소 제외)
 */
export type ArtKind = 'material' | 'aid' | 'mixture' | 'object';

export interface ArtAsset {
  id: string;
  kind: ArtKind;
  /** 검수 화면·보고서용 이름 */
  label: string;
  /** 그림이 나타내는 상태/식별 참고 (그림에는 쓰지 않음) */
  hint: string;
}

/** 이미지 프롬프트(08)가 정의한 48개 자산. 순서는 검수 화면 순서다. */
export const ART_ASSETS: ArtAsset[] = [
  { id: 'mat-hydrogen', kind: 'material', label: '수소', hint: 'H2 / g' },
  { id: 'mat-oxygen', kind: 'material', label: '산소', hint: 'O2 / g' },
  { id: 'mat-water', kind: 'material', label: '물', hint: 'H2O / l' },
  { id: 'mat-water-vapor', kind: 'material', label: '수증기', hint: 'H2O / g' },
  { id: 'mat-hydrogen-peroxide', kind: 'material', label: '과산화수소수', hint: 'H2O2 / aq' },
  { id: 'mat-methane', kind: 'material', label: '메테인', hint: 'CH4 / g' },
  { id: 'mat-magnesium', kind: 'material', label: '마그네슘', hint: 'Mg / s' },
  { id: 'mat-magnesium-oxide', kind: 'material', label: '산화마그네슘', hint: 'MgO / s' },
  { id: 'mat-sodium-bicarbonate', kind: 'material', label: '탄산수소나트륨', hint: 'NaHCO3 / s' },
  { id: 'mat-sodium-carbonate', kind: 'material', label: '탄산나트륨', hint: 'Na2CO3 / s' },
  { id: 'mat-carbon-dioxide', kind: 'material', label: '이산화탄소', hint: 'CO2 / g' },
  { id: 'mat-calcium-chloride', kind: 'material', label: '염화칼슘', hint: 'CaCl2 / stock' },
  { id: 'mat-calcium-carbonate', kind: 'material', label: '탄산칼슘', hint: 'CaCO3 / s' },
  { id: 'mat-sodium-chloride', kind: 'material', label: '염화나트륨', hint: 'NaCl / s' },
  { id: 'mat-calcium-oxide', kind: 'material', label: '산화칼슘', hint: 'CaO / s' },
  { id: 'mat-calcium-hydroxide', kind: 'material', label: '수산화칼슘', hint: 'Ca(OH)2 / stock' },
  { id: 'mat-hydrochloric-acid', kind: 'material', label: '염산 수용액', hint: 'HCl / aq' },
  { id: 'mat-hydrogen-chloride', kind: 'material', label: '염화수소 기체', hint: 'HCl / g' },
  { id: 'mat-sodium-hydroxide', kind: 'material', label: '수산화나트륨', hint: 'NaOH / stock' },
  { id: 'mat-magnesium-chloride', kind: 'material', label: '염화마그네슘', hint: 'MgCl2 / aq' },
  { id: 'mat-zinc', kind: 'material', label: '아연', hint: 'Zn / s' },
  { id: 'mat-copper-sulfate', kind: 'material', label: '황산구리(II)', hint: 'CuSO4 / aq' },
  { id: 'mat-zinc-sulfate', kind: 'material', label: '황산아연', hint: 'ZnSO4 / aq' },
  { id: 'mat-copper', kind: 'material', label: '구리', hint: 'Cu / s' },
  { id: 'mat-copper-oxide', kind: 'material', label: '산화구리(II)', hint: 'CuO / s' },
  { id: 'mat-copper-hydroxide', kind: 'material', label: '수산화구리(II)', hint: 'Cu(OH)2 / s' },
  { id: 'mat-sodium-sulfate', kind: 'material', label: '황산나트륨', hint: 'Na2SO4 / aq' },
  { id: 'mat-iron', kind: 'material', label: '철', hint: 'Fe / s' },
  { id: 'mat-iron-sulfate', kind: 'material', label: '황산철(II)', hint: 'FeSO4 / aq' },
  { id: 'mat-nitrogen', kind: 'material', label: '질소', hint: 'N2 / g' },
  { id: 'mat-ammonia', kind: 'material', label: '암모니아', hint: 'NH3 / g' },
  { id: 'mat-ammonium-chloride', kind: 'material', label: '염화암모늄', hint: 'NH4Cl / s' },
  { id: 'mat-glucose', kind: 'material', label: '포도당', hint: 'C6H12O6 / stock' },
  { id: 'mat-ethanol', kind: 'material', label: '에탄올', hint: 'C2H5OH / stock' },
  { id: 'mat-acetic-acid', kind: 'material', label: '아세트산', hint: 'CH3COOH / stock' },
  { id: 'mat-ethyl-acetate', kind: 'material', label: '아세트산에틸', hint: 'CH3COOC2H5 / stock' },
  { id: 'aid-manganese-dioxide', kind: 'aid', label: '이산화망가니즈 촉매 소재', hint: 'MnO2 / catalyst' },
  { id: 'aid-sulfuric-acid-catalyst', kind: 'aid', label: '산 촉매 소재', hint: 'H2SO4 / catalyst' },
  { id: 'aid-yeast', kind: 'aid', label: '효모 공정 보조물', hint: 'biological / biocatalyst' },
  { id: 'mix-gas-mixture', kind: 'mixture', label: '기체 혼합물', hint: '예: 이산화탄소 + 수증기' },
  { id: 'mix-precipitate-mixture', kind: 'mixture', label: '침전 혼합물', hint: '예: 탄산칼슘 + 염화나트륨 수용액' },
  { id: 'mix-aqueous-mixture', kind: 'mixture', label: '미분리 수용액', hint: '여러 용질이 섞인 용액' },
  { id: 'mix-organic-mixture', kind: 'mixture', label: '유기 혼합물', hint: '예: 에스터 + 물 + 잔류 반응물' },
  { id: 'obj-support-closed', kind: 'object', label: '연구지원품 닫힌 상자', hint: '라운드 배송' },
  { id: 'obj-support-open', kind: 'object', label: '연구지원품 열린 배송 트레이', hint: '실제 추첨 아이콘을 얹음' },
  { id: 'obj-support-return', kind: 'object', label: '반송할 지원품 상자', hint: '반송 선택 표시' },
  { id: 'obj-recycling-crate', kind: 'object', label: '잉여 재고 회수 상자', hint: '재고 매입 바구니' },
  { id: 'obj-mission-board', kind: 'object', label: '작업대 의뢰 보드', hint: '가로형 1000px, border-image' },
];

export interface MaterialArtSpec {
  assetId: string;
  /** 같은 그림을 다른 상태와 나눠 쓰거나 그림이 '재고 포장'을 뜻할 때 붙이는 상태 배지 */
  badge?: string;
}

/**
 * 게임 물질 39종 → 그림. 액체 물과 수증기, 염산 수용액과 염화수소 기체는 서로 다른 그림이다.
 * 결정/용액 변형은 기본 물질 그림 + 상태 배지로 나타내고, 배지 없이 다른 상태로 오해하게 두지 않는다.
 */
export const MATERIAL_ART: Record<string, MaterialArtSpec> = {
  H2_g: { assetId: 'mat-hydrogen' },
  O2_g: { assetId: 'mat-oxygen' },
  N2_g: { assetId: 'mat-nitrogen' },
  CH4_g: { assetId: 'mat-methane' },
  CO2_g: { assetId: 'mat-carbon-dioxide' },
  NH3_g: { assetId: 'mat-ammonia' },
  HCl_g: { assetId: 'mat-hydrogen-chloride' },
  H2O_g: { assetId: 'mat-water-vapor' },
  H2O_l: { assetId: 'mat-water' },
  H2O2_aq: { assetId: 'mat-hydrogen-peroxide' },
  HCl_aq: { assetId: 'mat-hydrochloric-acid' },
  NaOH_aq: { assetId: 'mat-sodium-hydroxide', badge: '수용액' },
  NaCl_aq: { assetId: 'mat-sodium-chloride', badge: '수용액' },
  CaCl2_aq: { assetId: 'mat-calcium-chloride', badge: '수용액' },
  MgCl2_aq: { assetId: 'mat-magnesium-chloride' },
  ZnSO4_aq: { assetId: 'mat-zinc-sulfate' },
  CuSO4_aq: { assetId: 'mat-copper-sulfate' },
  Na2SO4_aq: { assetId: 'mat-sodium-sulfate' },
  FeSO4_aq: { assetId: 'mat-iron-sulfate' },
  glucose_aq: { assetId: 'mat-glucose', badge: '수용액' },
  ethanol_aq: { assetId: 'mat-ethanol', badge: '발효액' },
  Mg_s: { assetId: 'mat-magnesium' },
  MgO_s: { assetId: 'mat-magnesium-oxide' },
  NaHCO3_s: { assetId: 'mat-sodium-bicarbonate' },
  Na2CO3_s: { assetId: 'mat-sodium-carbonate' },
  CaCl2_s: { assetId: 'mat-calcium-chloride', badge: '고체' },
  CaO_s: { assetId: 'mat-calcium-oxide' },
  CaOH2_s: { assetId: 'mat-calcium-hydroxide' },
  CaCO3_s: { assetId: 'mat-calcium-carbonate' },
  NaCl_s: { assetId: 'mat-sodium-chloride', badge: '결정' },
  Zn_s: { assetId: 'mat-zinc' },
  Cu_s: { assetId: 'mat-copper' },
  CuO_s: { assetId: 'mat-copper-oxide' },
  CuOH2_s: { assetId: 'mat-copper-hydroxide' },
  Fe_s: { assetId: 'mat-iron' },
  NH4Cl_s: { assetId: 'mat-ammonium-chloride' },
  ethanol_l: { assetId: 'mat-ethanol', badge: '정제' },
  aceticAcid_l: { assetId: 'mat-acetic-acid' },
  ethylAcetate_l: { assetId: 'mat-ethyl-acetate' },
};

/** 혼합물 로트의 베이스 그림: 로트 태그로 고른다. 정확한 구성은 성분 아이콘과 이름을 코드로 겹친다. */
export function mixtureArtId(tags: string[]): string {
  if (tags.includes('gasMixture')) return 'mix-gas-mixture';
  if (tags.includes('suspension')) return 'mix-precipitate-mixture';
  if (tags.includes('liquidMixture')) return 'mix-organic-mixture';
  return 'mix-aqueous-mixture';
}

export const MIXTURE_LABEL: Record<string, string> = {
  'mix-gas-mixture': '섞인 기체',
  'mix-precipitate-mixture': '고체+용액',
  'mix-organic-mixture': '섞인 액체',
  'mix-aqueous-mixture': '섞인 용액',
};

/** 촉매 모듈 → 공정 보조물 그림. Fe 촉매(U09)는 철 그림과 기존 촉매 장비 그림을 함께 쓴다. */
export const CATALYST_ART: Record<string, string> = {
  U08: 'aid-manganese-dioxide',
  U09: 'mat-iron',
  U10: 'aid-sulfuric-acid-catalyst',
};

/** 반응에 쓰이지만 소모되지 않는 공정 보조물 (거래 가능한 순물질이 아니다) */
export const PROCESS_AID: Record<string, { assetId: string; label: string }> = {
  R21: { assetId: 'aid-yeast', label: '효모 (공정 보조물 · 소모되지 않음)' },
};

export function artForMaterial(materialId: string): MaterialArtSpec | null {
  return MATERIAL_ART[materialId] ?? null;
}

export const ART_IDS = new Set(ART_ASSETS.map((a) => a.id));
