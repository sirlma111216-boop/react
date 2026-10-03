import { MATERIALS } from '../../shared/chemistry/materials';
import { ELEMENT_COLOR, ionText } from '../../shared/chemistry/atoms';
import { FormulaBody } from './common';

/** 원소 하나 (기호 항상 표시) */
function Atom({ el, cx, cy, r = 9 }: { el: string; cx: number; cy: number; r?: number }) {
  const fill = ELEMENT_COLOR[el] ?? '#999';
  const dark = ['H', 'S', 'Cl', 'Mg', 'Ca'].includes(el) ? '#1f2a2b' : '#fff';
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={fill} stroke="rgba(0,0,0,0.25)" strokeWidth="0.8" />
      <text x={cx} y={cy + r * 0.35} textAnchor="middle" fontSize={r * 0.95} fontWeight="700" fill={dark} fontFamily="system-ui">{el}</text>
    </g>
  );
}

type Layout = { a: [string, number, number][]; b: [number, number][] };

/**
 * 원자 연결이 실제와 같은 분자 배치표 (좌표는 scale 1 기준 px, 각도는 대략).
 * 결합선은 '어느 원자끼리 이어져 있는지'만 나타낸다(이중 결합은 구분하지 않음).
 */
const LAYOUT: Record<string, Layout> = {
  H2O: { a: [['O', 0, -4], ['H', -14, 7], ['H', 14, 7]], b: [[0, 1], [0, 2]] },
  CO2: { a: [['O', -18, 0], ['C', 0, 0], ['O', 18, 0]], b: [[0, 1], [1, 2]] },
  H2O2: { a: [['H', -23, 9], ['O', -9, 0], ['O', 9, 0], ['H', 23, -9]], b: [[0, 1], [1, 2], [2, 3]] },
  C2H5OH: {
    a: [['C', -18, 0], ['C', 0, 0], ['O', 18, 0], ['H', 30, -9], ['H', -33, 0], ['H', -18, -15], ['H', -18, 15], ['H', 0, -15], ['H', 0, 15]],
    b: [[0, 1], [1, 2], [2, 3], [0, 4], [0, 5], [0, 6], [1, 7], [1, 8]],
  },
  CH3COOH: {
    a: [['C', -18, 0], ['C', 0, 0], ['O', 9, -15], ['O', 17, 7], ['H', 31, 2], ['H', -33, 0], ['H', -18, -15], ['H', -18, 15]],
    b: [[0, 1], [1, 2], [1, 3], [3, 4], [0, 5], [0, 6], [0, 7]],
  },
};

/** 중심 원자 하나에 나머지가 붙는 분자(NH₃, CH₄, HCl)와 같은 원소 2개(H₂·O₂·N₂)를 위한 기본 배치 */
function defaultLayout(composition: Record<string, number>): Layout | null {
  const entries = Object.entries(composition);
  const total = entries.reduce((a, [, n]) => a + n, 0);
  if (total === 2) {
    const els = entries.flatMap(([el, n]) => Array.from({ length: n }, () => el));
    return { a: [[els[0]!, -9, 0], [els[1]!, 9, 0]], b: [[0, 1]] };
  }
  const singles = entries.filter(([, n]) => n === 1);
  if (singles.length !== 1 || total > 7) return null;
  const center = singles[0]![0];
  const rest = entries.filter(([el]) => el !== center).flatMap(([el, n]) => Array.from({ length: n }, () => el));
  const a: Layout['a'] = [[center, 0, 0]];
  rest.forEach((el, i) => {
    const ang = (Math.PI * 2 * i) / rest.length - Math.PI / 2;
    a.push([el, Math.round(Math.cos(ang) * 17), Math.round(Math.sin(ang) * 17)]);
  });
  return { a, b: rest.map((_, i) => [0, i + 1] as [number, number]) };
}

/** 분자 한 개: 원자 연결은 실제와 같고 각도는 대략 나타낸 그림. 원자가 많은 분자는 원자 수만 보여 준다. */
export function Molecule({ materialId, scale = 1 }: { materialId: string; scale?: number }) {
  const m = MATERIALS[materialId];
  if (!m) return null;
  const layout = LAYOUT[m.formula] ?? defaultLayout(m.composition);
  if (!layout) {
    return <span className="pv-formula" role="img" aria-label={`${m.displayName} 원자 수`}>{Object.entries(m.composition).map(([el, n]) => `${el} ${n}개`).join(' · ')}</span>;
  }
  const rOf = (el: string) => (el === 'H' ? 6.5 : 9) * scale;
  const pad = 2;
  const xs = layout.a.map(([el, x]) => [x * scale - rOf(el), x * scale + rOf(el)]).flat();
  const ys = layout.a.map(([el, , y]) => [y * scale - rOf(el), y * scale + rOf(el)]).flat();
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad, minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
  const w = maxX - minX, h = maxY - minY;
  const P = (x: number, y: number) => ({ x: x * scale - minX, y: y * scale - minY });
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${m.displayName} 분자 모형`}>
      {layout.b.map(([i, j], k) => { const p = P(layout.a[i]![1], layout.a[i]![2]); const q = P(layout.a[j]![1], layout.a[j]![2]); return <line key={k} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#7d8889" strokeWidth={2 * scale} />; })}
      {layout.a.map(([el, x, y], i) => { const p = P(x, y); return <Atom key={i} el={el} cx={p.x} cy={p.y} r={rOf(el)} />; })}
    </svg>
  );
}

/** 이온 결정 격자: 양이온·음이온이 엇갈려 반복되고, 개수 비율은 화학식과 같다 (예: NaCl 1:1, CaCl₂ 1:2) */
export function IonicLattice({ materialId, scale = 1 }: { materialId: string; scale?: number }) {
  const m = MATERIALS[materialId];
  if (!m?.ions) return null;
  const cells: { label: string; charge: number }[] = [];
  for (const ion of m.ions) for (let i = 0; i < ion.count; i++) cells.push({ label: ionText(ion), charge: ion.charge });
  const n = cells.length;
  const long = cells.some((c) => c.label.length > 3);
  const cols = 4;
  const rows = 3;
  const size = (long ? 26 : 22) * scale;
  const w = cols * size + 8;
  const h = rows * size + 8;
  const items: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cell = cells[(r + c) % n]!;
    const x = 4 + c * size + size / 2;
    const y = 4 + r * size + size / 2;
    const fill = cell.charge > 0 ? '#A96CD6' : '#5EC9B5';
    items.push(
      <g key={`${r}-${c}`}>
        <circle cx={x} cy={y} r={size * 0.45} fill={fill} stroke="rgba(0,0,0,0.25)" strokeWidth="0.8" />
        <text x={x} y={y + size * 0.1} textAnchor="middle" fontSize={size * (cell.label.length > 3 ? 0.27 : 0.34)} fontWeight="700" fill="#fff" fontFamily="system-ui">{cell.label}</text>
      </g>,
    );
  }
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${m.displayName} 이온 결정 모형`}>
      {items}
    </svg>
  );
}

/** 물질 하나의 대표 입자 그림 (분자 / 이온 결정 / 물에 녹은 이온 / 금속) */
export function ParticleView({ materialId, count = 1, scale = 0.8 }: { materialId: string; count?: number; scale?: number }) {
  const m = MATERIALS[materialId];
  if (!m) return null;
  const items = Array.from({ length: Math.min(count, 4) }, (_, i) => i);
  if (m.structureClass === 'ionic' && m.phase !== 'aq') return <div className="pv-group"><IonicLattice materialId={materialId} scale={scale} /><span className="pv-label">이온 결정 ×{count}</span></div>;
  // 수용액은 이온으로 나뉘어 있다 (염산 HCl 도 물에서 H⁺ 와 Cl⁻ 로 나뉜다)
  if (m.phase === 'aq' && m.ions) {
    const ions = m.ions.flatMap((ion) => Array.from({ length: ion.count }, () => ion));
    return (
      <div className="pv-group">
        <div style={{ display: 'flex', gap: 2 }}>{ions.map((ion, i) => {
          const label = ionText(ion);
          const d = 26 * scale;
          return <svg key={i} width={d + 6} height={d + 4} role="img" aria-label={label}><circle cx={d / 2 + 3} cy={d / 2 + 2} r={d / 2} fill={ion.charge > 0 ? '#A96CD6' : '#5EC9B5'} /><text x={d / 2 + 3} y={d / 2 + 2 + d * 0.13} textAnchor="middle" fontSize={d * (label.length > 3 ? 0.3 : 0.38)} fontWeight="700" fill="#fff">{label}</text></svg>;
        })}</div>
        <span className="pv-label">물에 녹아 이온으로 나뉨 ×{count}</span>
      </div>
    );
  }
  if (m.structureClass === 'metallic') {
    const el = Object.keys(m.composition)[0]!;
    return (
      <div className="pv-group">
        <svg width={60 * scale} height={40 * scale} viewBox="0 0 60 40">{[0, 1, 2].map((r) => [0, 1, 2, 3].map((c) => <Atom key={`${r}${c}`} el={el} cx={8 + c * 14 + (r % 2) * 7} cy={8 + r * 12} r={6} />))}</svg>
        <span className="pv-label">금속 결정 ×{count}</span>
      </div>
    );
  }
  const big = !LAYOUT[m.formula] && !defaultLayout(m.composition);
  return (
    <div className="pv-group">
      <div style={{ display: 'flex', gap: 2 }}>{big ? <Molecule materialId={materialId} scale={scale} /> : items.map((i) => <Molecule key={i} materialId={materialId} scale={scale} />)}</div>
      <span className="pv-label"><FormulaBody formula={m.formula} /> 분자 ×{count}</span>
    </div>
  );
}
