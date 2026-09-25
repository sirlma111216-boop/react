import { MATERIALS } from '../../shared/chemistry/materials';
import { ELEMENT_COLOR } from '../../shared/chemistry/atoms';

/** 원소 하나 (기호 항상 표시) */
function Atom({ el, cx, cy, r = 9 }: { el: string; cx: number; cy: number; r?: number }) {
  const fill = ELEMENT_COLOR[el] ?? '#999';
  const dark = ['H', 'S', 'Cl', 'Mg', 'Ca'].includes(el) ? '#1f2a2b' : '#fff';
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={fill} stroke="rgba(0,0,0,0.25)" strokeWidth="0.8" />
      <text x={cx} y={cy + 3.2} textAnchor="middle" fontSize={r * 0.95} fontWeight="700" fill={dark} fontFamily="system-ui">{el}</text>
    </g>
  );
}

/** 분자 한 개: 화학식 원자 수를 그대로 배치 (실제 결합 각도를 주장하지 않는 도식) */
export function Molecule({ materialId, scale = 1 }: { materialId: string; scale?: number }) {
  const m = MATERIALS[materialId];
  if (!m) return null;
  const atoms: string[] = [];
  for (const [el, n] of Object.entries(m.composition)) for (let i = 0; i < n; i++) atoms.push(el);
  // 중심 원자(가장 개수가 적고 무거운 것)를 가운데, 나머지를 둘레에
  const center = Object.entries(m.composition).sort((a, b) => a[1] - b[1])[0]![0];
  const rest = atoms.filter((a) => a !== center);
  const centers = atoms.filter((a) => a === center);
  const R = 9 * scale;
  const w = 64 * scale;
  const h = 56 * scale;
  const cx = w / 2;
  const cy = h / 2;
  const nodes: { el: string; x: number; y: number }[] = [];
  if (centers.length === 1 && rest.length <= 6) {
    nodes.push({ el: center, x: cx, y: cy });
    rest.forEach((el, i) => {
      const a = (Math.PI * 2 * i) / rest.length - Math.PI / 2;
      nodes.push({ el, x: cx + Math.cos(a) * R * 2.05, y: cy + Math.sin(a) * R * 2.05 });
    });
  } else {
    // 사슬형 배치 (예: C2H5OH, CH3COOH)
    const cols = Math.min(atoms.length, 5);
    const rows = Math.ceil(atoms.length / cols);
    atoms.sort((a, b) => (a === center ? -1 : b === center ? 1 : 0));
    atoms.forEach((el, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      nodes.push({ el, x: cx + (col - (cols - 1) / 2) * R * 1.9, y: cy + (row - (rows - 1) / 2) * R * 1.9 });
    });
  }
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${m.formula} 분자 모형`}>
      {nodes.slice(1).map((n, i) => (nodes[0] && centers.length === 1 && rest.length <= 6 ? <line key={i} x1={nodes[0].x} y1={nodes[0].y} x2={n.x} y2={n.y} stroke="#7d8889" strokeWidth={2 * scale} /> : null))}
      {nodes.map((n, i) => <Atom key={i} el={n.el} cx={n.x} cy={n.y} r={R} />)}
    </svg>
  );
}

/** 이온 결정 격자: 양이온·음이온이 교대로 반복 (예: NaCl 1:1, CaCl2 1:2) */
export function IonicLattice({ materialId, scale = 1 }: { materialId: string; scale?: number }) {
  const m = MATERIALS[materialId];
  if (!m?.ions) return null;
  const cells: { label: string; charge: number; el: string }[] = [];
  for (const ion of m.ions) for (let i = 0; i < ion.count; i++) cells.push({ label: ion.formula.replace(/\s/g, ''), charge: ion.charge, el: ion.formula.replace(/[^A-Za-z]/g, '').slice(0, 2) });
  const n = cells.length;
  const cols = 4;
  const rows = 3;
  const size = 22 * scale;
  const w = cols * size + 8;
  const h = rows * size + 8;
  const items: React.ReactNode[] = [];
  let k = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cell = cells[(k++) % n]!;
    const x = 4 + c * size + size / 2;
    const y = 4 + r * size + size / 2;
    const fill = cell.charge > 0 ? '#A96CD6' : '#5EC9B5';
    items.push(
      <g key={`${r}-${c}`}>
        <circle cx={x} cy={y} r={size * 0.42} fill={fill} stroke="rgba(0,0,0,0.25)" strokeWidth="0.8" />
        <text x={x} y={y + 3} textAnchor="middle" fontSize={size * 0.36} fontWeight="700" fill="#fff" fontFamily="system-ui">{cell.label.length > 4 ? cell.el : cell.label}</text>
      </g>,
    );
  }
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${m.formula} 이온 격자 모형`}>
      {items}
    </svg>
  );
}

/** 물질 하나의 대표 입자 그림 (구조 분류에 따라 분자/이온 격자/금속) */
export function ParticleView({ materialId, count = 1, scale = 0.8 }: { materialId: string; count?: number; scale?: number }) {
  const m = MATERIALS[materialId];
  if (!m) return null;
  const items = Array.from({ length: Math.min(count, 4) }, (_, i) => i);
  if (m.structureClass === 'ionic' && m.phase !== 'aq') return <div className="pv-group"><IonicLattice materialId={materialId} scale={scale} /><span className="pv-label">이온 결정 ×{count}</span></div>;
  if (m.structureClass === 'ionic' && m.phase === 'aq') {
    return (
      <div className="pv-group">
        <div style={{ display: 'flex', gap: 2 }}>{m.ions?.map((ion, i) => (
          <svg key={i} width={26 * scale + 10} height={26 * scale + 4}><circle cx={13 * scale + 5} cy={13 * scale + 2} r={12 * scale} fill={ion.charge > 0 ? '#A96CD6' : '#5EC9B5'} /><text x={13 * scale + 5} y={13 * scale + 5} textAnchor="middle" fontSize={9 * scale} fontWeight="700" fill="#fff">{ion.formula.replace(/\s/g, '')}</text></svg>
        ))}</div>
        <span className="pv-label">수용액 이온 ×{count}</span>
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
  return (
    <div className="pv-group">
      <div style={{ display: 'flex', gap: 2 }}>{items.map((i) => <Molecule key={i} materialId={materialId} scale={scale} />)}</div>
      <span className="pv-label">{m.formula} 분자 ×{count}</span>
    </div>
  );
}
