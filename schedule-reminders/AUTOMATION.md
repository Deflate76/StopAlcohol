# Firebase 일정 함수 자동 배포

`.github/workflows/deploy-firebase-functions.yml`은 PR에서 테스트를 실행하고, `Rollback-version2`에 일정 관련 변경이 들어오면 테스트 성공 후 `alcoholaway`의 `daily-schedules` 코드베이스를 배포합니다. 수동 재배포도 GitHub Actions에서 실행할 수 있습니다.

최초 Firebase 연결은 프로젝트 운영자가 한 번 실행해야 합니다. 이 PR을 작성한 환경에는 Google Cloud 인증이 없어 운영 IAM 설정이나 실제 배포를 실행하지 않았습니다.

## 최초 1회 설정

1. `alcoholaway` 프로젝트의 IAM 역할·서비스 계정·Workload Identity Pool을 관리하고 API를 활성화할 수 있는 계정으로 [Google Cloud Shell](https://shell.cloud.google.com/?project=alcoholaway)을 엽니다. Firebase 프로젝트에는 Blaze 결제가 활성화되어 있어야 합니다.
2. 아래 명령으로 작업 브랜치를 받아 연결 스크립트를 실행합니다. 이 명령은 대용량 이미지 폴더를 받지 않습니다. 경로를 홈 디렉터리 기준으로 지정하므로 현재 위치는 관계없습니다.

```bash
git clone --depth 1 --filter=blob:none --sparse --branch codex/daily-schedule-reminders https://github.com/Deflate76/StopAlcohol.git "$HOME/StopAlcohol-schedule-deploy"
git -C "$HOME/StopAlcohol-schedule-deploy" sparse-checkout set schedule-reminders
cd "$HOME/StopAlcohol-schedule-deploy/schedule-reminders"
bash setup-github-deploy.sh
```

앞서 같은 경로로 복제했다면 첫 두 줄 대신 아래 명령으로 갱신합니다.

```bash
git -C "$HOME/StopAlcohol-schedule-deploy" pull --ff-only
cd "$HOME/StopAlcohol-schedule-deploy/schedule-reminders"
bash setup-github-deploy.sh
```

3. 스크립트가 성공하면 [PR #1](https://github.com/Deflate76/StopAlcohol/pull/1)을 검토하여 `Rollback-version2`에 병합합니다. PR이 Draft 상태이면 Ready for review로 전환한 뒤 병합합니다. 저장소 Actions가 비활성화되어 있다면 GitHub Settings → Actions에서 활성화해야 합니다.
4. GitHub → Actions → **Firebase functions**의 `test`와 `deploy` 성공을 확인합니다. 인증 권한 전파에 몇 분 걸릴 수 있습니다. 이미 병합한 경우에는 **Run workflow**에서 `Rollback-version2`를 선택해 실행합니다.
5. [데이터 접근 규칙과 실제 기기 확인](README.md#데이터-접근)을 완료합니다. 사이트의 `index.html`, `daily-schedules.js`, `firebase-messaging-sw.js`도 기존 사이트 배포 방식으로 반영되어 있어야 합니다.

이 자동화는 일정 함수 두 개와 Firestore 관리자 API를 배포합니다. 관리자 API의 최초 배포 권한 연결은 [관리자 배포 안내](../firestore-admin/README.md#기존-github-자동-배포에-관리자-api-추가)를 참고하세요. 웹사이트는 기존 GitHub Pages 배포를 사용하므로 Firebase Hosting 설정을 추가하지 않습니다. Firestore 규칙은 저장소에 없어 자동 교체하지 않습니다.

## 연결과 권한

GitHub의 단기 OIDC 인증을 Google Workload Identity Federation으로 교환합니다. 서비스 계정 키 파일을 생성하거나 업로드하지 않습니다. 인증 조건은 저장소 ID `1207749530`, 소유자 ID `233573528`, `Rollback-version2`, 해당 워크플로 경로, `push` 또는 `workflow_dispatch` 이벤트를 모두 검증합니다. PR·다른 브랜치·포크는 배포 인증을 받을 수 없습니다.

| 계정 | 설정하는 역할 |
| --- | --- |
| `firebase-github-deploy` | Cloud Functions Admin, Cloud Run Admin, Cloud Scheduler Admin, Service Usage Admin, Firebase Viewer |
| `daily-schedules-runtime` | Cloud Datastore User, Firebase Cloud Messaging API Admin |
| 프로젝트의 기본 Cloud Build 계정 | Cloud Build Service Account 역할 |
| Google 관리 Cloud Scheduler 서비스 에이전트 | Cloud Scheduler Service Agent 역할 |

배포 계정의 `Service Account User`는 함수 실행 계정, 기본 빌드 계정(Compute 계정일 때), App Engine 기본 계정(존재할 때)에만 부여합니다. 마지막 항목은 Firebase CLI 15.31.0의 사전 권한 검사를 위한 것입니다. 프로젝트 전체에 `Service Account User` 또는 Owner 역할을 부여하지 않습니다. Service Usage Admin은 Firebase CLI의 Gen 2 API/서비스 ID 준비에 사용됩니다.

스크립트는 프로젝트 ID와 번호를 먼저 확인하고, 없는 계정/인증 풀/공급자를 생성합니다. 기존 공급자가 다른 신뢰 조건을 사용하거나 비활성 상태라면 덮어쓰지 않고 중단합니다. 같은 설정에서는 다시 실행할 수 있으며, IAM 정책은 해당 바인딩만 추가합니다. 실행 중 오류가 나면 일부 API/계정/역할은 이미 생성되었을 수 있으므로 원인을 해결한 뒤 다시 실행합니다.

함수 삭제가 필요한 변경은 `--non-interactive` 배포가 실패할 수 있습니다. 실제 삭제 목록을 검토한 뒤 운영자가 수동으로 처리합니다. 자동화에는 `--force`를 넣지 않았습니다.

## 실패했을 때

| 증상 | 확인할 사항 |
| --- | --- |
| `No such file or directory` | 위 복제 명령으로 작업 브랜치를 받고 홈 디렉터리 기준 절대 경로를 사용합니다. 기본 브랜치에는 병합 전까지 이 폴더가 없습니다. |
| `package.json` 없음 / `default:daily-schedules` 필터 오류 | 저장소 최상위에서 실행한 명령이 상위 폴더의 다른 Firebase 설정을 찾은 경우입니다. `npm --prefix`에는 `schedule-reminders/functions`까지, Firebase에는 `--config "$HOME/StopAlcohol-schedule-deploy/schedule-reminders/firebase.json"`을 명시합니다. |
| 스크립트의 `PERMISSION_DENIED` | Cloud Shell 로그인 계정이 `alcoholaway`의 IAM/API 관리 권한을 가지고 있는지 확인합니다. |
| 인증 조건/공급자 불일치 | 기존 인증 설정을 확인합니다. 스크립트는 다른 설정을 임의로 덮어쓰지 않습니다. |
| Actions 인증 실패 | 최초 연결 성공 여부와 권한 전파를 확인하고 `Rollback-version2`에서 다시 실행합니다. |
| Billing 또는 API 오류 | Firebase Blaze 결제 상태 및 오류에 표시된 API/조직 정책을 확인합니다. |
| 함수 성공, 화면 저장 실패 | 프런트엔드 세 파일 배포와 로그인/App Check 설정을 확인합니다. |

워크플로는 Node.js 22, Firebase CLI 15.31.0, 커밋 SHA로 고정한 공식 GitHub Actions를 사용합니다. 배포 실행 중 다른 배포가 끼어들지 않도록 직렬화하며, 실행 중인 배포를 자동 취소하지 않습니다.

공식 자료: [Firebase CLI의 CI 인증](https://firebase.google.com/docs/cli#cli-ci-systems), [Google GitHub 인증 Action](https://github.com/google-github-actions/auth), [배포 파이프라인의 Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines).
