import type { ModePack, Preset, ModeId } from '../types';

const CLASSIC_R = ['R01', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R09'];
const EXT_R = [...CLASSIC_R, 'R02', 'R10', 'R11', 'R12', 'R13', 'R14', 'R15', 'R16', 'R17', 'R18'];
const CLASSIC_C = ['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07'];
const EXT_C = [...CLASSIC_C, 'C08', 'C09', 'C10'];
const CLASSIC_U = ['U01', 'U02', 'U03', 'U04', 'U08'];
const EXT_U = [...CLASSIC_U, 'U05'];

export const MODES: Record<ModeId, ModePack> = {
  classic: {
    id: 'classic', name: '클래식 공방', blurb: '반응 8장, 1~3단계 경로. 처음 시작하는 학급의 기본 모드.',
    presets: [
      { id: 'classic-standard', mode: 'classic', name: '표준 세트', blurb: '물·기체·탄산·세라믹 경로', reactions: CLASSIC_R, contracts: CLASSIC_C, equipment: CLASSIC_U },
    ],
  },
  extended: {
    id: 'extended', name: '확장 공방', blurb: '산·염기·금속·전해·회수 경로 추가. 반응 14장.',
    presets: [
      { id: 'extended-metal', mode: 'extended', name: '금속·회수 세트', blurb: '클래식 + 구리 회수, 중화, 전기분해', reactions: ['R01', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R09', 'R02', 'R10', 'R13', 'R14', 'R16', 'R17'], contracts: EXT_C, equipment: EXT_U },
      { id: 'extended-acid', mode: 'extended', name: '산·탄산염 세트', blurb: '클래식 + 염산 경로, 철 치환, 열분해', reactions: ['R01', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R09', 'R10', 'R11', 'R12', 'R15', 'R18', 'R13'], contracts: [...CLASSIC_C, 'C08', 'C09'], equipment: EXT_U },
      { id: 'extended-full', mode: 'extended', name: '전체 세트', blurb: '확장 반응 18장 전부', reactions: EXT_R, contracts: EXT_C, equipment: EXT_U },
    ],
  },
  industrial: {
    id: 'industrial', name: '산업 공방', blurb: '암모니아·발효·에스터, 부분 전환과 재활용. 검증된 시나리오 프리셋 3종.',
    presets: [
      { id: 'industrial-gas-carbonate-bio', mode: 'industrial', name: '기체·탄산·바이오', blurb: '암모니아 합성, 탄산칼슘, 발효·에스터', reactions: ['R01', 'R02', 'R03', 'R04', 'R19', 'R20', 'R06', 'R07', 'R08', 'R09', 'R11', 'R21', 'R22', 'R10'], contracts: ['C01', 'C02', 'C04', 'C05', 'C06', 'C07', 'C08', 'C11', 'C12', 'C13', 'C14'], equipment: ['U01', 'U02', 'U03', 'U04', 'U05', 'U06', 'U07', 'U08', 'U09', 'U10'] },
      { id: 'industrial-gas-metal-bio', mode: 'industrial', name: '기체·금속·바이오', blurb: '암모니아, 구리 회수, 발효·에스터', reactions: ['R01', 'R02', 'R03', 'R04', 'R19', 'R20', 'R05', 'R13', 'R14', 'R16', 'R17', 'R18', 'R21', 'R22', 'R12'], contracts: ['C01', 'C02', 'C03', 'C06', 'C08', 'C09', 'C10', 'C11', 'C12', 'C13', 'C14'], equipment: ['U01', 'U02', 'U03', 'U04', 'U05', 'U06', 'U07', 'U08', 'U09', 'U10'] },
      { id: 'industrial-carbonate-metal-gas', mode: 'industrial', name: '탄산·금속·기체', blurb: '탄산칼슘 순환, 구리 회수, 암모니아', reactions: ['R01', 'R02', 'R04', 'R06', 'R07', 'R08', 'R09', 'R11', 'R15', 'R05', 'R13', 'R14', 'R16', 'R17', 'R19', 'R20'], contracts: ['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08', 'C09', 'C10', 'C11', 'C12'], equipment: ['U01', 'U02', 'U03', 'U04', 'U05', 'U06', 'U07', 'U08', 'U09'] },
    ],
  },
};

export function findPreset(mode: ModeId, presetId?: string): Preset {
  const pack = MODES[mode];
  const p = presetId ? pack.presets.find((x) => x.id === presetId) : undefined;
  return p ?? pack.presets[0]!;
}

export const ALL_PRESETS: Preset[] = Object.values(MODES).flatMap((m) => m.presets);
