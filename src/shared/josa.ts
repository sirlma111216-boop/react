/**
 * 받침에 맞는 조사를 고른다. 예: josa('물', '이/가') → '이', josa('수소', '을/를') → '를', josa('산소', '으로/로') → '로'.
 * 끝의 괄호 묶음("산화구리(II)")과 따옴표·공백은 무시하고, 숫자는 한국어 읽기로 판단한다.
 */
const DIGIT_FINAL: Record<string, number> = { '0': 21, '1': 8, '2': 0, '3': 16, '4': 0, '5': 0, '6': 1, '7': 8, '8': 8, '9': 0 };

function finalConsonant(word: string): number | null {
  const w = word.replace(/\s*\([^)]*\)\s*$/, '').replace(/["'”’\s]+$/, '');
  const ch = w[w.length - 1];
  if (!ch) return null;
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28;
  if (ch in DIGIT_FINAL) return DIGIT_FINAL[ch]!;
  return null;
}

export function josa(word: string | number, pair: '이/가' | '을/를' | '은/는' | '와/과' | '으로/로'): string {
  const fc = finalConsonant(String(word));
  const [withFinal, withoutFinal] = pair === '와/과' ? ['과', '와'] : pair.split('/') as [string, string];
  if (fc === null) return pair === '으로/로' ? '(으)로' : `${withFinal}(${withoutFinal})`;
  if (pair === '으로/로') return fc === 0 || fc === 8 ? '로' : '으로';
  return fc === 0 ? withoutFinal : withFinal;
}
