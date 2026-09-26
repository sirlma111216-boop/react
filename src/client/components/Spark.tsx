export function Spark({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return <span className="muted small">{data[0] ?? '-'}</span>;
  const w = 60, h = 20;
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / Math.max(1, max - min)) * (h - 2) - 1}`).join(' ');
  return <svg className="spark" viewBox={`0 0 ${w} ${h}`} aria-label={`코인 변화 ${data[data.length - 1]}`}><polyline points={pts} fill="none" stroke={color} strokeWidth="2" /></svg>;
}
