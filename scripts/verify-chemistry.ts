import { verifyChemistry } from '../src/shared/chemistry/verify';

const { issues, checked } = verifyChemistry();
console.log('검사 항목:', checked);
for (const i of issues) console.log(`[${i.level}] ${i.where}: ${i.message}`);
const errors = issues.filter((i) => i.level === 'error');
if (errors.length) {
  console.error(`화학 검증 실패: 오류 ${errors.length}건`);
  process.exit(1);
}
console.log(`화학 검증 통과 (경고 ${issues.length - errors.length}건)`);
