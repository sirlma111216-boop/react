# 완료 체크리스트 (실제 수행 여부)

| 항목 | 상태 | 근거 |
|---|---|---|
| 세 모드(클래식·확장·산업) 작동, 프리셋 7종 | 완료 | `verify:chemistry` 프리셋 도달 가능성 검사, `sim:smoke` 세 모드 완주 |
| 반응 22 · 계약 14 · 설비 10 · 가공 4 · 물질 39 | 완료 | `src/shared/chemistry`, 검사 항목 수 출력 |
| 질량 보존·일정 성분비·기체 부피비·이온/분자 구분·상태 구분 | 완료 | `tests/chemistry.test.ts`, 원장 검증(`verifyTeamLedger`) 매 정산 |
| 부분 전환(R20·R22)·촉매 시간 단축·열회수 상한 | 완료 | 단위 테스트 |
| 교사 방 생성 → 팀장 임명 → 팀 생성 → 학생 가입 → 준비 → 시작 | 완료 | `scripts/e2e-ws.mjs` 30명 실서버 44/44 통과, 브라우저 수동 확인 |
| 조작 담당자 순환·이탈 15초 유예·교사 조작권 이전 | 완료 | e2e(30명 담당자 알림 수신), 코드 `assignOperators` |
| 담당자만 실행, 팀원은 핑·메모 | 완료 | e2e 검사 |
| 중복 commandId 멱등, 잘못된 토큰 거절, 닉네임 중복 거절, 일반 학생의 교사 명령 거절 | 완료 | e2e 검사 |
| 재접속 복구(같은 토큰), 일시정지/재개/연장/타이머 배율/조기 종료 | 완료 | e2e + 코드 |
| 비공개 입찰(예약금·슬롯 예약·동률 시드 우선순위·승자만 지불) | 완료 | `tests/engine.test.ts` |
| 다른 팀 비공개 정보 미전송(역할별 projection) | 완료 | e2e payload 검사 |
| 서버 알람 타이머(초당 tick 없음), 늦은 알람 순차 처리 | 완료 | `RoomDurableObject.alarm` |
| Durable Object SQLite storage 저장·휴면 복구 | 완료 | `new_sqlite_classes` 마이그레이션, `load()`/`save()` |
| 방 만료(대기실 2h·종료 24h·최대 48h)·결과 내보내기 | 완료 | `maybeExpire`, `/export`, 결과 화면 JSON/CSV |
| 데스크톱 3열 보드 / 모바일 하단 탭 / 교사 관전 보드 / 결과 / 연습 / 도감 | 완료 | 브라우저 확인(1366×768, 390px) |
| 이미지 19장 WebP + manifest + 코드 fallback | 완료 | `scripts/build-assets.mjs`, `AssetImage` |
| 오디오 | **미제작** (무음 fallback) | manifest `status: missing` |
| 정책 봇 6종·헤드리스 시뮬레이터·밸런스 탐색·검증·보고서 | 완료 | `reports/balance/*.json`, `BALANCE_REPORT.md` (실제 실행) |
| 밸런스 에이전트 정의 | 완료 | `.claude/agents/balance-designer.md` |
| CI(타입·린트·테스트·화학·짧은 시뮬·빌드·dry-run) | 완료 | `.github/workflows/ci.yml` |
| GitHub 저장소·Cloudflare 배포 | 완료/확인 | README 최종 보고 참조 |
| 인간 플레이테스트 | **미수행** | KNOWN_LIMITATIONS |
| 실제 학교 무선망 30대 성능 측정 | **미수행** | KNOWN_LIMITATIONS |

## V2 (2026-09-26) 추가 확인

| 항목 | 상태 | 근거 |
|---|---|---|
| 4개 장소 화면(의뢰소·공방·상점·출하장) 배경·NPC·주된 조작이 서로 다름 | 완료 | 브라우저 캡처(1366×768, 390×844) |
| 게임플레이 타이머 비활성화, 준비 완료 기반 라운드, 정산 1회 | 완료 | `tests/manual-round.test.ts`, e2e 49/49(멈춤·취소·건너뛰기·동시 준비) |
| 시세(기본금 ±8%, 정산 시 결정적 추첨), 견적 버전 검증, 구버전 고정가 | 완료 | 단위 테스트, e2e |
| 장비 설치·재료 입고·가동·트레이·배달의 그래픽 상태 변화 | 완료 | 브라우저 확인 |
| 관측 기록·교사 내보내기 요약 | 완료 | e2e export 검사 |
| 밸런스 재검증 (시세·보류 정책 포함) | 완료 | `reports/balance/BALANCE_REPORT.md` |
| 사람 플레이테스트 | **미수행** | `docs/UX_REVISION_V2.md` 남은 항목 |

## V3 (2026-09-27) 추가 확인

| 항목 | 상태 | 근거 |
|---|---|---|
| 규칙 감사 문서 | 완료 | `docs/V3_RULE_AUDIT.md` |
| 물질 그림 48종 WebP 변환·크기 변형·매핑 39/39·누락 0 | 완료 | `npm run assets:validate`, `reports/material-asset-coverage.json`, `reports/asset-contact-sheet.png` |
| 추가 물질 프롬프트 | 해당 없음(미매핑 0) | `reports/ADDITIONAL_ASSET_PROMPTS.md` |
| 공통 MaterialArt 를 상점·선반·작업 카드·트레이·의뢰·보드·출하대·지원품·매입·결과·도감에 연결, 이모지·SVG 병·색 네모 제거 | 완료 | 코드, 브라우저 확인 |
| 작업 카드 6영역(헤더·재료→결과·반응식·비용·가능 여부·행동), 420px 최소 폭·1열 전환 | 완료 | 1366×768·375×812 브라우저 확인 |
| 작업대 위 의뢰 보드(준비됨/정리 필요/작업 중/아직 필요, 공용 표시, 카드 강조, 0.9초 반짝, 출하장으로) | 완료 | `tests/v3.test.ts` 의뢰 보드 5건, 브라우저 확인 |
| 연구지원품(3묶음 중 2, 잠금, 담당자 확정, 팀원 제안, 교사 대리·수령 포기, 재추첨 없음, 1라운드 연결성) | 완료 | `tests/v3.test.ts` 13건, e2e V3 항목 19건 |
| 잉여 재고 매입(라운드 1회·한도·0코인 거절·견적 확인·차익 불가·부족 경고) | 완료 | `tests/v3.test.ts` 12건, e2e 2건 |
| 경제 가치 원장 불변식 | 완료 | 시뮬레이션 매 정산 검사, 검증 2,016경기 불일치 0 |
| 타이머 비활성 유지 | 완료 | `tests/manual-round.test.ts`, e2e "시간이 흘러도 라운드·행동이 그대로" |
| V3 밸런스 검증(정책 9종, 2,016경기) | 완료 | `reports/balance/BALANCE_REPORT.md`, `docs/DECISIONS.md` |
| 실서버 통합 테스트 | 완료 | 로컬 workerd 70/70 (학생 24명·6팀) |
| 배포 | 이 문서 작성 시점 미배포 | 사용자 확인 후 push |
| 사람 플레이테스트 | **미수행** | `docs/UX_REVISION_V3.md` 남은 항목 |
