/** 팀 문양 8종. 색만으로 팀을 구분하지 않도록 모양이 함께 다르다. */
export function Emblem({ shape, color, size = 24, label }: { shape: string; color: string; size?: number; label?: string }) {
  const s = size;
  const c = color;
  let body: React.ReactNode;
  switch (shape) {
    case 'triangle': body = <polygon points="12,3 21,20 3,20" fill={c} />; break;
    case 'diamond': body = <polygon points="12,2 22,12 12,22 2,12" fill={c} />; break;
    case 'hexagon': body = <polygon points="12,2 20.7,7 20.7,17 12,22 3.3,17 3.3,7" fill={c} />; break;
    case 'star': body = <polygon points="12,2 14.9,8.6 22,9.3 16.6,14.1 18.2,21 12,17.4 5.8,21 7.4,14.1 2,9.3 9.1,8.6" fill={c} />; break;
    case 'square': body = <rect x="3.5" y="3.5" width="17" height="17" rx="3" fill={c} />; break;
    case 'wave': body = <path d="M2 14c3-6 6-6 9 0s6 6 9 0v6H2z" fill={c} />; break;
    case 'leaf': body = <path d="M4 20C4 9 10 4 20 4c0 10-5 16-16 16zm2-2c6-1 10-5 12-12" fill={c} stroke="#fff" strokeWidth="1" />; break;
    default: body = <circle cx="12" cy="12" r="9.5" fill={c} />;
  }
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" role="img" aria-label={label ?? shape} style={{ flex: 'none' }}>
      {body}
    </svg>
  );
}
