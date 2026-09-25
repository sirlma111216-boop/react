import { useEffect, useState } from 'react';
import { serverNow } from './store';

/** 서버 deadline 을 보간해 남은 초를 표시한다. 서버는 tick 을 보내지 않는다. */
export function useCountdown(phaseEndsAt: number | null, pausedRemaining: number | null): number {
  const calc = () => {
    if (pausedRemaining !== null) return Math.ceil(pausedRemaining / 1000);
    if (phaseEndsAt === null) return 0;
    return Math.max(0, Math.ceil((phaseEndsAt - serverNow()) / 1000));
  };
  const [sec, setSec] = useState(calc);
  useEffect(() => {
    setSec(calc());
    const t = setInterval(() => setSec(calc()), 500);
    return () => clearInterval(t);
  }, [phaseEndsAt, pausedRemaining]);
  return sec;
}
