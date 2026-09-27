import type { TeamState } from '../../shared/types';

/**
 * 반응 원료 자리에 보여 줄 물질. 한 자리가 여러 상태를 받을 때(예: 염화칼슘 고체/수용액)
 * 창고에 있는 것 → 상점에서 파는 것 → 대표(첫 항목) 순으로 고른다. 없는 상태 이름으로 헷갈리게 하지 않는다.
 */
export function slotMaterial(accepts: string[], team: TeamState | null, shop: string[]): string {
  if (team) {
    const held = accepts.find((a) => team.lots.some((l) => l.kind === 'pure' && l.materialId === a && l.units > 0));
    if (held) return held;
  }
  return accepts.find((a) => shop.includes(a)) ?? accepts[0]!;
}
