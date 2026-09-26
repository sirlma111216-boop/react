import type { ContractInstance, TeamState } from '../../shared/types';
import { CONTRACTS, CATEGORY_LABEL } from '../../shared/chemistry/contracts';
import { MATERIALS } from '../../shared/chemistry/materials';
import { contractSatisfiable, tagLabel } from '../../shared/engine/commands';
import { AssetImage } from './common';

function DistrictFallback({ category }: { category: string }) {
  const color = category === 'metal' ? '#B87346' : category === 'water' ? '#5a9bd4' : category === 'gas' ? '#5EC9B5' : category === 'bio' ? '#5FB37A' : '#1F6F78';
  return <svg className="cimg" viewBox="0 0 54 54" aria-hidden><rect width="54" height="54" rx="10" fill="#ede6d8" /><rect x="12" y="20" width="30" height="22" rx="4" fill={color} /><rect x="20" y="12" width="14" height="10" rx="2" fill={color} opacity="0.7" /></svg>;
}

/** 주문 카드: 무엇을 몇 개, 어떤 조건으로 가져오면 얼마를 주는지 */
export function ContractCard({ c, team, round, mode, actions }: { c: ContractInstance; team: TeamState | null; round: number; mode: 'offer' | 'held' | 'auction' | 'plain'; actions?: React.ReactNode }) {
  const t = CONTRACTS[c.templateId]!;
  const sat = team ? contractSatisfiable(team, c) : { ok: false, missing: [] as string[] };
  const left = c.deadlineRound - round;
  return (
    <div className={`ccard ${mode === 'held' ? 'held' : ''} ${c.special ? 'special' : ''}`}>
      <AssetImage id={t.imageId} alt={CATEGORY_LABEL[t.category]} className="cimg" fallback={<DistrictFallback category={t.category} />} />
      <div>
        <div className="row-between"><span className="ctitle">{c.title}</span><span className="reward">+{c.reward}코인</span></div>
        <div className="muted small">{t.blurb}</div>
        <div className="creq">
          {c.requirements.map((r, i) => {
            const have = team ? team.lots.filter((l) => l.kind === 'pure' && l.materialId === r.materialId && l.grade !== 'purchased' && l.tags.some((x) => r.tags.includes(x))).reduce((a, l) => a + l.units, 0) : 0;
            const done = !!team && have >= r.units;
            return <span key={i} className={`tag ${done ? 'tag-teal' : ''}`} title={`조건: ${r.tags.map(tagLabel).join(' 또는 ')}`}>{done ? '✓ ' : ''}{MATERIALS[r.materialId]!.displayName} {team ? `${Math.min(have, r.units)}/` : ''}{r.units}개 <span style={{ opacity: 0.7 }}>({r.tags.map(tagLabel).join('/')})</span></span>;
          })}
        </div>
        <div className="row-between" style={{ marginTop: 4 }}>
          <span className={`deadline ${left <= 1 && mode === 'held' ? 'urgent' : ''}`}>{c.special ? '게임 끝까지' : mode === 'held' ? `${c.deadlineRound}라운드까지 (${left}라운드 남음)` : `${c.deadlineRound}라운드까지`}{c.bidPaid ? ` · 낙찰 ${c.bidPaid}코인` : ''}</span>
          {actions}
        </div>
        {mode === 'held' && !sat.ok && sat.missing.length > 0 && <div className="muted small">아직 부족: {sat.missing.join(', ')}</div>}
      </div>
    </div>
  );
}
