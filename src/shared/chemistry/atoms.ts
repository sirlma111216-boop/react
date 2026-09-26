/**
 * 교육용 반올림 원자량과 화학식 파서.
 * 두 원자량 체계를 섞지 않는다: 게임 전체는 이 표(교육용) 하나만 사용한다.
 */
export const ATOMIC_MASS: Record<string, number> = {
  H: 1, C: 12, N: 14, O: 16, Na: 23, Mg: 24, S: 32, Cl: 35.5, Ca: 40, Mn: 55, Fe: 56, Cu: 63.5, Zn: 65,
};

export const ELEMENT_NAME_KO: Record<string, string> = {
  H: '수소', C: '탄소', N: '질소', O: '산소', Na: '나트륨', Mg: '마그네슘', S: '황', Cl: '염소', Ca: '칼슘',
  Mn: '망가니즈', Fe: '철', Cu: '구리', Zn: '아연',
};

/** 원소별 표시 색 (색 외에 기호도 항상 함께 표시한다) */
export const ELEMENT_COLOR: Record<string, string> = {
  H: '#F2F0EA', C: '#5A5A5A', N: '#4F7CC9', O: '#D9534F', Na: '#A96CD6', Mg: '#5FB37A', S: '#E0C85A', Cl: '#5EC9B5',
  Ca: '#8D8D8D', Mn: '#B47A9E', Fe: '#B8763F', Cu: '#B87346', Zn: '#7A8FA6',
};

/**
 * 화학식 파싱. 괄호와 정수 계수를 지원한다. 예: Ca(OH)2 → {Ca:1,O:2,H:2}
 * 상태 표기(s/l/g/aq)나 전하는 파싱하지 않는다 — 별도 필드로 둔다.
 */
export function parseFormula(formula: string): Record<string, number> {
  const out: Record<string, number> = {};
  const stack: Record<string, number>[] = [{}];
  let i = 0;
  const s = formula.replace(/\s/g, '');
  const num = (): number => {
    let j = i;
    while (j < s.length && s[j]! >= '0' && s[j]! <= '9') j++;
    const n = j === i ? 1 : parseInt(s.slice(i, j), 10);
    i = j;
    return n;
  };
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '(') {
      stack.push({});
      i++;
    } else if (ch === ')') {
      i++;
      const n = num();
      const grp = stack.pop()!;
      const top = stack[stack.length - 1]!;
      for (const [el, c] of Object.entries(grp)) top[el] = (top[el] ?? 0) + c * n;
    } else if (ch >= 'A' && ch <= 'Z') {
      let el = ch;
      i++;
      if (i < s.length && s[i]! >= 'a' && s[i]! <= 'z') {
        el += s[i];
        i++;
      }
      const n = num();
      const top = stack[stack.length - 1]!;
      top[el] = (top[el] ?? 0) + n;
    } else {
      throw new Error(`화학식 파싱 실패: ${formula} (위치 ${i})`);
    }
  }
  if (stack.length !== 1) throw new Error(`괄호 불일치: ${formula}`);
  for (const [el, c] of Object.entries(stack[0]!)) out[el] = c;
  return out;
}

export function molarMassOf(composition: Record<string, number>): number {
  let m = 0;
  for (const [el, n] of Object.entries(composition)) {
    const a = ATOMIC_MASS[el];
    if (a === undefined) throw new Error(`원자량 없음: ${el}`);
    m += a * n;
  }
  return Math.round(m * 100) / 100;
}

const SUB = '₀₁₂₃₄₅₆₇₈₉';
/** 글자나 ')' 뒤의 숫자만 아래첨자로 바꾼다. 앞의 계수(2H2O 의 2)는 그대로. 예: "2H2O(g)" → "2H₂O(g)", "Ca(OH)2" → "Ca(OH)₂" */
export function subscriptFormula(text: string): string {
  return text.replace(/([A-Za-z)])(\d+)/g, (_m, a: string, d: string) => a + [...d].map((c) => SUB[Number(c)] ?? c).join(''));
}

/** 원소 질량비 (예: 물 H:O = 2:16 → 1:8) */
export function massRatio(composition: Record<string, number>): { element: string; mass: number; percent: number }[] {
  const total = molarMassOf(composition);
  return Object.entries(composition).map(([el, n]) => {
    const mass = ATOMIC_MASS[el]! * n;
    return { element: el, mass, percent: Math.round((mass / total) * 1000) / 10 };
  });
}
