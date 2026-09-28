# 날짜별 일정과 푸시 리마인드

`index.html`의 건강기록 → **일정 등록**, 오른쪽 **메뉴 → 일정**이 동일한 팝업을 엽니다. 시작일/시각·종료일/시각, 제목, 메모와 알림 시점을 저장합니다. 시작 시각, 5/10/15/30분·1/2시간·1일·1주 전, 직접 지정, 알림 없음을 지원합니다. 여러 날에 걸친 일정은 겹치는 날짜의 건강기록에 표시됩니다. 일정 수정·삭제 시 대기 중인 알림도 함께 바뀝니다.

팝업은 과거·미래의 **전체 일정**을 시간순으로 표시합니다. **일정 선택**에서 날짜·시각·제목을 선택하면 해당 카드로 스크롤하고 강조하며, 카드의 **일정 선택으로 가기**로 선택란에 돌아갑니다. 달력에는 일정이 있는 날짜에 📅와 일정 개수를 표시합니다. 종료 시각이 자정이면 종료 날짜는 포함하지 않습니다. 왼쪽 아래에는 **이동**, 오른쪽 아래에는 일정·도우미·통신·커피·약식별이 펼쳐지는 **메뉴**가 있습니다.

전체 조회는 기존 본인 계정 API에 추가된 `listAll`을 사용하며, 50개씩 모든 페이지를 자동 조회합니다. 자동 배포에서는 병합 후 **Firebase schedule functions와 pages build and deployment가 모두 완료**되어야 새 전체 목록을 사용할 수 있습니다. 수동 배포라면 `schedule-reminders/functions/service.mjs`의 함수 배포를 먼저 완료하고 프런트엔드를 배포하세요. 기존 날짜별 `list` 요청도 계속 지원합니다.

## 적용

프런트엔드와 Firebase 함수를 모두 배포해야 사용할 수 있습니다. `index.html`만 교체해서는 일정 저장/푸시가 동작하지 않습니다. 이 변경에서는 운영 Firebase에 배포하거나 실제 기기로 테스트 알림을 보내지 않았습니다.

**자동 배포:** [최초 연결 안내](AUTOMATION.md)에 따라 Cloud Shell에서 `setup-github-deploy.sh`를 한 번 실행하고 PR을 `Rollback-version2`에 병합합니다. 이후 일정 함수 변경은 GitHub Actions에서 테스트 후 배포됩니다. 서비스 계정 키나 GitHub Secret 입력은 필요 없습니다.

수동 배포가 필요하면 PR을 병합한 뒤 아래 명령으로 최신 기본 브랜치를 받습니다. 현재 위치에 저장소가 없어도 홈 디렉터리 기준으로 복제합니다.

```bash
git clone --depth 1 --filter=blob:none --sparse --branch Rollback-version2 https://github.com/Deflate76/StopAlcohol.git "$HOME/StopAlcohol-schedule-deploy"
git -C "$HOME/StopAlcohol-schedule-deploy" sparse-checkout set schedule-reminders
cd "$HOME/StopAlcohol-schedule-deploy/schedule-reminders"
bash setup-github-deploy.sh
```

이 경로에 이미 복제했다면 새로 복제하지 말고 아래 명령으로 최신 기본 브랜치를 가져옵니다. 예전 작업 브랜치의 `pull`만으로는 새 변경을 받을 수 없습니다. 작업 중인 로컬 변경 때문에 병합이 중단되면 해당 변경부터 보존하세요.

```bash
git -C "$HOME/StopAlcohol-schedule-deploy" fetch origin Rollback-version2
git -C "$HOME/StopAlcohol-schedule-deploy" merge --ff-only FETCH_HEAD
```

최초 연결 스크립트는 이미 성공했다면 다시 실행할 필요가 없습니다. 실행이 필요한 경우 `alcoholaway` 프로젝트의 IAM/API를 설정할 수 있는 계정을 사용합니다.

**수동 배포:** 최초 연결 스크립트로 실행 서비스 계정을 만든 뒤 같은 폴더에서 실행할 수도 있습니다.

```bash
(
  set -e
  npm ci --prefix "$HOME/StopAlcohol-schedule-deploy/schedule-reminders/functions"
  npm test --prefix "$HOME/StopAlcohol-schedule-deploy/schedule-reminders/functions"
  firebase deploy --config "$HOME/StopAlcohol-schedule-deploy/schedule-reminders/firebase.json" --project alcoholaway --only functions:daily-schedules
)
```

Firebase CLI가 없는 환경에서는 먼저 `npm install -g firebase-tools@15.31.0`으로 설치하고 로그인된 계정을 사용합니다. 로컬 컴퓨터에서는 필요할 때 `firebase login`을 실행합니다. 기존 `firestore-admin`이나 기존 금주/복약 함수를 덮어쓰지 않도록 별도 코드베이스 `daily-schedules`로 배포합니다. 해당 폴더의 `firebase.json`에는 Functions만 포함되어 있습니다.

배포되는 함수:

| 이름 | 지역 | 용도 |
| --- | --- | --- |
| `dailyScheduleApi` | `asia-northeast3` | 인증된 본인 일정 등록·조회·수정·삭제, 기기 토큰 등록 |
| `dispatchDailyScheduleReminders` | `asia-northeast3` | 매분 예정 알림 확인 및 FCM 발송 |

예약 함수는 Cloud Scheduler를 사용하므로 결제가 활성화된 Firebase 프로젝트와 Cloud Scheduler API가 필요합니다. 배포 계정에 Functions/Cloud Run/Scheduler 배포 권한이 있어야 하며, 함수의 실행 서비스 계정에는 Firestore 접근 및 FCM 발송 권한이 있어야 합니다. `dailyScheduleApi`는 기존 사이트의 Firebase App Check를 강제 적용합니다. App Check를 끄거나 관리자 권한을 일반 사용자에게 부여할 필요가 없습니다.

함수 배포 후 기본 브랜치에 변경사항을 병합하여 기존 사이트 배포 방식으로 아래 파일을 함께 반영합니다.

- `index.html`
- `daily-schedules.js`
- `floating-actions.js`
- `firebase-messaging-sw.js`

## 데이터 접근

일정 데이터는 공개 사용자 프로필이나 커뮤니티에 쓰지 않습니다.

| Firestore 경로 | 내용 |
| --- | --- |
| `daily_schedule_accounts/{uid}/events/{id}` | 본인 일정, 알림 설정/상태, 수정 버전 |
| `daily_schedule_queue/{hash}` | 발송 대기 및 일시적인 작업 잠금 |
| `daily_schedule_devices/{tokenHash}` | 일정 푸시를 허용한 기기 토큰과 계정 |

세 경로는 **클라이언트의 직접 읽기/쓰기를 허용하지 않아야 합니다.** 모든 접근은 로그인·App Check를 검증하는 callable 함수와 서버 Admin SDK를 사용합니다. 현재 운영 Firestore 규칙은 이 저장소에 포함되어 있지 않으므로 배포 전에 확인해야 합니다. 기존 규칙이 기본 거부 방식이면 추가 허용 규칙은 필요 없습니다. 전체 규칙 파일을 교체하지 말고, 필요한 경우 아래 match를 기존 `/databases/{database}/documents` 안에 넣습니다.

```text
match /daily_schedule_accounts/{document=**} {
  allow read, write: if false;
}
match /daily_schedule_queue/{document=**} {
  allow read, write: if false;
}
match /daily_schedule_devices/{document=**} {
  allow read, write: if false;
}
```

Firestore에서는 겹치는 규칙 중 하나라도 허용하면 접근됩니다. `match /{document=**}` 같은 넓은 허용 규칙이 있다면 위 거부 규칙만 추가하지 말고 해당 허용 조건에서 이 세 경로를 제외해야 합니다. 기존 건강기록 등의 규칙은 보존합니다. 기본 단일 필드 인덱스를 사용하므로 복합 인덱스 배포는 필요 없습니다.

## 알림 동작과 확인

- 저장 버튼을 누를 때 푸시 권한을 요청하고, 토큰 등록과 일정 저장이 완료된 뒤에만 저장 성공을 표시합니다. 권한 거부/미지원일 때는 입력을 보존하며 ‘알림 없음’으로 저장할 수 있습니다.
- 시간은 입력 기기의 현지 시각에서 절대 시각으로 변환해 저장합니다. 알림 문구에는 저장 당시 시간대의 시작 시각을 표시합니다.
- 매분 대기 큐를 확인하므로 지정 시각 이후 약 1분의 확인 간격이 있습니다. 네트워크·OS 절전·기기 알림 설정에 따라 실제 수신은 더 늦어질 수 있습니다. FCM 접수 성공이 실제 화면 표시를 보장하지는 않습니다.
- 서버가 재실행되어도 트랜잭션 잠금과 일정 버전을 확인합니다. 일시적 실패는 최대 5회 시도하며, 접수에 성공한 기기는 재시도에서 제외합니다. 서버가 FCM 접수 직후 중단되는 드문 경우의 재전송은 동일 알림 태그로 표시를 합칩니다. 완전한 exactly-once 전달을 보장하지 않습니다.
- 이미 종료된 일정이나 알림 시각에서 하루 이상 지난 일정은 발송하지 않습니다. 실제 발송 중인 일정은 잠깐 수정·삭제가 제한됩니다. FCM에 접수된 알림은 삭제하더라도 기기로의 전달을 회수할 수 없습니다.
- 같은 토큰을 다른 계정에서 등록하면 가장 최근 계정으로 소유자가 바뀝니다. 앱을 닫아도 등록된 기기로 알림을 받습니다. 로그아웃은 기기 알림 권한 해제와 별개입니다.
- 알림을 누르면 해당 일정을 엽니다. 이미 열린 사이트에서는 입력 중인 건강기록을 보존하고 일정 팝업을 표시합니다.
- 날짜별 목록은 50개 단위로 조회하며, ‘이전에 시작한 일정 더 보기’로 이전에 시작해서 해당 날짜에도 이어지는 일정을 계속 조회할 수 있습니다.

배포 후 본인 계정으로 시작을 5분 뒤, 직접 지정 알림을 2분 뒤로 만든 뒤 탭을 닫고 실제 수신과 알림 클릭을 확인하세요. 이어서 시간을 변경한 일정의 이전 시각 알림이 취소되는지, 삭제한 일정의 알림이 오지 않는지 확인합니다. 테스트할 때도 메모는 푸시에 전송되지 않으며 제목과 시작 시각만 표시됩니다.

## 검증

```bash
npm test --prefix functions
```

총 19개 단위 테스트로 인증/계정 분리, 날짜 경계, 전체 목록의 여러 페이지와 같은 시작 시각 처리, 동일 요청 재시도, 동시 수정 충돌, 일정 수정·삭제와 알림 큐의 일관성, 스케줄러 중복 실행, 일부 기기 실패 재시도, 만료 토큰·지난 일정 처리를 테스트합니다. 단위 테스트는 메모리 Firestore 대역과 FCM 대역을 사용하며 운영 프로젝트에 접근하지 않습니다. 이번 전체 목록·부채 메뉴 변경은 실제 HTML과 스크립트에 서버 대역을 연결한 DOM 검사 32개로 확인했습니다. 브라우저의 로컬 미리보기 접근 제한으로 이번 변경의 실제 화면 렌더링은 검증하지 못했습니다. 실제 기기 푸시 수신도 배포 후 확인 대상입니다.

Firebase 공식 문서: [예약 함수](https://firebase.google.com/docs/functions/schedule-functions), [웹 메시지 수신](https://firebase.google.com/docs/cloud-messaging/js/receive), [Admin SDK 발송](https://firebase.google.com/docs/cloud-messaging/send/admin-sdk).
