# AlcoholAway Firestore 관리자

접속 주소: **https://www.alcoholaway.com/admin.html**

`admin.html`과 `firestore-admin/`를 `index.html`과 같은 저장소에 배포합니다. 웹 화면만 올리면 데이터 접근이 활성화되지는 않습니다. 아래 절차로 **관리자 API 배포와 관리자 계정 지정**을 한 번 완료해야 합니다.

## 제공 기능

- 루트/하위 컬렉션 탐색, 문서 경로 바로 열기, 한 페이지 25개 문서 조회
- 읽어온 문서의 필드 경로 선택 목록, 같음·크기 비교·배열에 값 포함·문자열 부분 포함 검색
- 문서 생성, 필드 추가·수정·삭제, 객체·배열 표 편집과 타입 JSON 동기화, 중첩 변경 확인 후 저장
- 정확한 문서 경로를 입력한 뒤 문서 삭제. 하위 컬렉션이 있으면 삭제 거부
- 문서 JSON 내보내기, 관리자 작업 이력 조회
- 다른 클라이언트에서 먼저 변경한 문서의 덮어쓰기 방지, 재시도 시 중복 작업 방지

## 1. Firebase 프로젝트 확인

대상 프로젝트는 `alcoholaway`, 데이터베이스는 `(default)`, 함수 리전은 `asia-northeast3`입니다.

프로젝트 관리 권한이 있는 Google 계정으로 [Firebase Console](https://console.firebase.google.com/project/alcoholaway/overview)에 접속합니다.

1. Cloud Functions 배포가 가능한 Blaze 요금제와 결제 계정이 필요합니다. 함수 실행, Firestore 읽기/쓰기, 빌드 및 이미지 저장에 사용량 기준 비용이 발생할 수 있습니다. 함수 최대 인스턴스 수는 2, 최소는 0으로 설정했습니다.
2. Authentication에서 Google 로그인을 활성화하고, 승인된 도메인에 `www.alcoholaway.com`과 `alcoholaway.com`을 등록합니다.
3. App Check의 기존 웹 앱에서 reCAPTCHA Enterprise 설정을 확인합니다. 이 페이지는 기존 사이트와 동일한 웹 앱 및 사이트 키를 사용하며, API는 App Check를 필수로 검사합니다. Enterprise 키의 허용 도메인에도 위 두 도메인이 필요합니다.
4. 관리자가 될 계정으로 AlcoholAway에서 Google 로그인을 한 번 완료합니다. Authentication의 사용자 목록에 생성되어 있어야 합니다.

기존 Firestore/Storage 보안규칙은 변경하지 않습니다. 브라우저에 Admin SDK 키나 서비스 계정 JSON 파일을 넣지 않습니다.

## 2. Cloud Shell에서 관리자 API 배포

[Google Cloud Shell](https://shell.cloud.google.com/?project=alcoholaway)을 열고 **프로젝트 관리자 계정**을 사용합니다. Node.js 22와 npm, gcloud가 필요합니다. 이미 저장소를 내려받았다면 해당 저장소를 최신 상태로 맞춘 뒤 폴더로 이동하세요.

저장소에 대용량 자료가 있으므로 아래 명령으로 최신 버전의 관리자 파일만 받습니다. `--no-checkout`으로 전체 파일 다운로드를 미루고, 필요한 경로를 선택한 뒤 파일을 받습니다. 실패한 전체 다운로드와 구분하기 위해 `StopAlcohol-admin`이라는 새 폴더를 사용합니다.

```bash
cd ~ &&
git -c http.version=HTTP/1.1 clone \
  --depth 1 --single-branch --no-tags \
  --filter=blob:none --no-checkout \
  --branch Rollback-version2 \
  https://github.com/Deflate76/StopAlcohol.git StopAlcohol-admin &&
cd StopAlcohol-admin &&
git sparse-checkout set --no-cone '/admin.html' '/firestore-admin/' &&
git checkout Rollback-version2 &&
cd firestore-admin
```

다운로드가 성공하고 `~/StopAlcohol-admin/firestore-admin` 폴더에 들어온 뒤 다음 명령을 실행합니다. 중간에 오류가 나면 해당 단계에서 멈추고 확인합니다. `StopAlcohol-admin`이 이미 있다는 오류가 나면 폴더를 삭제하지 말고 기존 다운로드 상태를 먼저 확인하세요.

```bash
bash prepare-iam.sh &&
cd functions &&
npm ci &&
npm test &&
cd .. &&
npx firebase-tools login --no-localhost &&
npx firebase-tools deploy --project alcoholaway --config firebase.json --only functions:firestore-admin
```

`prepare-iam.sh`는 전용 실행 계정 `firestore-admin-console@alcoholaway.iam.gserviceaccount.com`을 만들고 Firestore 데이터 접근 및 Firebase Authentication 조회 역할만 부여합니다. 기존 사용자 IAM 역할은 수정하지 않습니다. 배포 계정에는 이 서비스 계정으로 함수를 실행할 `iam.serviceAccounts.actAs` 권한과 Cloud Functions 배포 권한이 필요합니다. 권한 오류가 나면 프로젝트 IAM 관리자가 배포 계정의 권한을 확인해야 합니다.

별도 `codebase: firestore-admin`과 배포 대상을 사용하므로 다른 코드베이스의 기존 함수 삭제를 요청하지 않습니다. 이 폴더의 Firebase 설정에는 보안규칙이나 Hosting 배포 대상이 없습니다. 이 배포는 `firestoreAdminApi` 함수만 대상으로 합니다.

서비스 계정 생성 직후에는 IAM 반영에 60초 이상 걸려 `Service account ... does not exist`가 일시적으로 나올 수 있습니다. 스크립트는 해당 오류와 알려진 일시적 오류에 한해 간격을 늘리며 최대 9회 시도합니다. 권한 부족이나 조건식 오류는 즉시 중단하고 원문을 표시합니다. 생성된 계정을 삭제할 필요는 없습니다. 공식 안내: [서비스 계정 생성 후 반영 지연](https://docs.cloud.google.com/iam/docs/service-accounts-create), [IAM 재시도](https://docs.cloud.google.com/iam/docs/retry-strategy).

이미 이전 버전으로 실패했다면 다음 명령으로 수정본을 받고 다시 실행합니다.

```bash
cd ~/StopAlcohol-admin/firestore-admin &&
git pull --ff-only &&
bash prepare-iam.sh
```

`관리자 API 전용 실행 계정을 준비했습니다`가 나오면 위 설치 명령의 `cd functions`부터 이어서 실행합니다. `lint-condition`은 검사할 조건식을 입력받는 별도 명령이므로 계정 반영 지연을 해결하는 절차에는 필요하지 않습니다.

## 3. 관리자 계정 지정

위 폴더에서 운영자용 Application Default Credentials로 로그인합니다. 서비스 계정 키 파일을 만들 필요가 없습니다. 이 작업을 실행하는 Google 계정에는 Firebase Authentication 사용자/커스텀 클레임을 변경할 권한이 필요합니다.

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project alcoholaway
cd functions
node set-admin.mjs grant alcoholaway powerzenith@gmail.com
```

마지막 이메일은 실제 관리자로 지정할 Google 계정으로 바꿀 수 있습니다. 스크립트는 기존 커스텀 클레임을 보존하며 `firestoreAdmin: true`만 추가합니다. 실행 결과의 프로젝트, UID, 이메일을 확인하세요. 화면에 이메일이 일치한다는 이유만으로 관리자 권한이 생기지는 않습니다.

관리자 해제:

```bash
node set-admin.mjs revoke alcoholaway powerzenith@gmail.com
```

API가 매 요청마다 Firebase Auth의 현재 사용자 상태와 클레임을 확인하므로 해제 후 새 요청은 거부됩니다. 이미 승인되어 진행 중인 요청까지 취소하는 기능은 아닙니다.

## 4. 관리자 화면 사용

1. https://www.alcoholaway.com/admin.html 에서 지정한 Google 계정으로 로그인하고 **권한 새로고침**을 누릅니다.
2. 컬렉션에서 `users`를 선택하고 사용자 UID 문서를 엽니다.
3. 하위 컬렉션의 `prescription_records`, `prescription_photos`, `health_entries` 등을 열어 필요한 기록을 관리합니다. 문서 본문이 없는 상위 경로도 탐색할 수 있습니다.
4. 전체 경로 입력으로 아직 없는 컬렉션을 열고 새 문서를 만들 수도 있습니다. 예: `users/사용자UID/prescription_records`.
5. 수정은 **변경 확인 · 저장**에서 바뀐 필드와 삭제될 필드를 확인한 후 확정합니다. 충돌이 나면 **새로 불러오기**로 최신 원본을 확인하고 필요한 편집을 다시 적용합니다.
6. **관리자 작업 이력**에서 작업자 UID, 작업 종류, 문서 경로, 시각을 확인합니다. 이력은 이 화면에서 변경할 수 없습니다.

정수는 64비트 숫자 문자열, 날짜는 UTC RFC3339 문자열로 취급하여 브라우저 숫자 변환/밀리초 변환으로 생기는 손실을 피합니다. 객체와 배열은 **표로 편집**하거나 접힌 **타입 JSON 보기 · 편집**을 펼쳐 편집합니다. 저장 가능한 편집 내용은 타입 JSON 900KB 이하입니다. 원래 문서의 모든 필드를 불러온 후 저장하며, 편집기에서 삭제한 필드는 실제 문서에서도 제거됩니다.

```json
{
  "name": {"stringValue": "예시"},
  "count": {"integerValue": "9223372036854775807"},
  "active": {"booleanValue": true},
  "createdAt": {"timestampValue": "2026-09-27T04:00:00.123456789Z"},
  "tags": {"arrayValue": {"values": [{"stringValue": "확인"}]}}
}
```

문서 삭제는 해당 Firestore 문서만 삭제합니다. 연결된 Storage 사진, 다른 컬렉션의 참조, Firebase Authentication 사용자 계정은 별도로 남습니다. 하위 컬렉션 탐색 후 삭제 여부를 검사하지만, 동시에 별도 클라이언트가 새 하위 문서를 만드는 경우까지 잠그지는 못합니다. 하위 트리 전체 삭제 및 자동 연쇄 삭제는 지원하지 않습니다.

## 권한과 변경 이력

- 클라이언트의 인증된 ID 토큰에 `firestoreAdmin === true`가 있어야 합니다.
- API는 App Check 토큰, 현재 Auth 계정의 관리자 클레임/이메일 인증/비활성화 상태/토큰 폐기 시각도 검사합니다. 쓰기 직전에 한 번 더 확인합니다.
- 전용 서비스 계정으로 Firestore REST API를 사용합니다. 이 서버 접근은 사용자용 Firestore 보안규칙을 거치지 않으며 IAM으로 허용합니다. 관리자 권한은 프로젝트의 데이터 전체를 관리할 수 있는 신뢰된 운영자에게만 지정합니다.
- 쓰기에는 `updateTime` 조건을 걸고, 데이터 변경과 `_firestore_admin_audit/{requestId}` 기록을 원자적으로 함께 저장합니다. 이력에 건강정보 원문이나 전후 데이터 사본은 기록하지 않습니다.
- 클라이언트에서 감사 컬렉션에 직접 쓰지 못하도록 기존 규칙의 기본 거부를 유지합니다. 이력이 별도 IAM 관리자나 Firebase Console에서도 수정 불가능한 규제용 감사 저장소인 것은 아닙니다.
- 편집 중인 데이터는 브라우저 메모리에만 두고 로그아웃/계정 변경 시 지웁니다. 개인정보를 URL, localStorage, 분석/광고 스크립트로 보내지 않습니다. 명시적인 JSON 내보내기는 사용자의 기기에 파일을 저장합니다.

## 연결 문제

| 화면/오류 | 확인할 항목 |
| --- | --- |
| Git 다운로드 중 `early EOF` / `invalid index-pack output` | 전송 도중 연결이 끊겼습니다. 위의 관리자 경로만 받는 명령으로 새 폴더에 다운로드합니다. |
| 관리자로 등록된 계정만 접근 가능 | 같은 프로젝트·계정의 관리자 지정 여부, 권한 새로고침 |
| 함수 연결 실패 / not-found | `firestoreAdminApi` 배포 완료 여부와 `asia-northeast3` 리전 |
| 앱 인증 실패 / unauthenticated | App Check 웹 앱, Enterprise 키, 승인된 도메인 및 재로그인 |
| Firestore 접근 권한 오류 | 전용 실행 계정의 `roles/datastore.user`, `roles/firebaseauth.viewer` |
| 검색 인덱스 오류 | 해당 필드의 인덱스 제외 설정, Firebase Console의 Firestore 인덱스 |
| 원본 변경 충돌 | 문서를 새로 불러온 뒤 변경사항 재적용 |
| localhost/GitHub Pages 기본 도메인에서 차단 | 기본 허용 Origin은 두 AlcoholAway 운영 도메인입니다. 별도 환경은 함수 CORS와 Firebase/Auth/App Check 도메인을 함께 설정해야 합니다. |

## 검증

```bash
cd firestore-admin/functions
npm ci
npm test
```

테스트는 모의 Auth/Firestore와 DOM을 사용하며 실제 운영 데이터는 변경하지 않습니다. 실제 로그인, App Check, IAM, 함수 배포 및 운영 데이터 연결은 배포 후 위 화면에서 별도로 확인해야 합니다.

공식 문서: [관리자 커스텀 클레임](https://firebase.google.com/docs/auth/admin/custom-claims), [호출형 함수](https://firebase.google.com/docs/functions/callable), [App Check 적용](https://firebase.google.com/docs/app-check/cloud-functions), [함수 코드베이스](https://firebase.google.com/docs/functions/organize-functions), [Firestore REST commit](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit).


## 배열·객체 표 편집

전체 경로에 `drug_catalogs/otc_review_20260926_33a241232f55/products/195700020`을 입력해 열고 객체/배열 필드의 **표로 편집**을 누릅니다.

- 객체 배열은 객체 하나를 한 행으로, 각 필드를 한 열로 표시합니다. 행별로 다른 필드도 열을 합쳐 보여주며, 없는 필드와 null을 구분합니다.
- **행 추가**, 행별 **삭제**, **행 편집**, **모든 행에 필드 추가**를 사용할 수 있습니다. 객체 표에서는 필드 이름·타입·값을 변경하고 필드를 추가/삭제합니다.
- 중첩 객체·배열은 **열기**로 이동하고 상단 경로로 돌아옵니다. 많은 행은 25개씩 표시하며 나머지 데이터도 유지합니다.
- 표 변경은 타입 JSON에 즉시 반영됩니다. **이 표의 변경 취소**는 표를 열기 전 내용으로 되돌립니다. 전체 타입 JSON을 수정한 뒤 표를 다시 열어도 변경된 내용이 표시됩니다.
- **편집 마치기 → 변경 확인 · 저장**에서 바뀐 내부 필드·배열 항목을 확인하고 **변경 저장**을 눌러야 Firestore가 바뀝니다. 변경 확인은 최대 100개 항목과 전체 변경 개수를 표시합니다.
- 잘못된 숫자·중복 필드 이름은 저장하지 않으며, 64비트 정수·나노초 날짜·문서 참조·바이너리 등 기존 타입을 유지합니다.

특정 제품 ID에 한정되지 않으며 모든 drug_catalogs 하위 문서와 다른 일반 문서에서 사용할 수 있습니다. 감사 기록은 읽기 전용입니다.

## 필드 목록과 포함 검색

컬렉션을 열면 읽어온 문서의 필드 및 중첩 객체 필드가 **필드 경로** 선택 목록에 들어갑니다. 선택한 문서의 필드도 추가됩니다. 문서마다 구조가 다르므로 모든 문서의 필드가 처음부터 들어 있다고 가정하지 않습니다. **다음 문서의 필드 더 찾기**로 25개씩 더 읽어 목록을 보충하거나 **직접 입력**을 선택하세요. 컬렉션 변경/로그아웃 시 목록을 비웁니다. 화면에는 최대 1,000개 경로를 유지하며 초과 필드는 직접 입력할 수 있습니다.

타입 **문자열**에서 **포함 (문자열)**을 선택하면 필드 값 중간에 검색어가 들어 있어도 찾습니다. 대소문자를 구분하는 실제 부분 문자열 검색이며 정규식이 아닙니다. 공백도 검색어의 일부입니다. 한글 및 120자 미리보기 뒤의 내용도 검색합니다. 기존 **배열에 포함**과는 별도 조건입니다.

기존 Firestore Core 쿼리를 사용하며 별도 검색 서비스나 Enterprise 전환은 필요 없습니다. 서버가 선택한 필드만 읽어 한 번에 최대 200개를 검사하고 일치 문서를 최대 25개 반환합니다(다음 범위 확인을 위해 최대 201개 읽기). **다음 검색 범위**로 컬렉션 끝까지 이어서 검색합니다. 이번 범위에 일치 항목이 없어도 다음 범위가 있으면 안내와 버튼이 유지됩니다. 읽은 문서 수에 따른 Firestore 읽기 비용이 발생합니다. 하위 컬렉션은 별도로 열어 검색합니다.

## 기존 GitHub 자동 배포에 관리자 API 추가

포함 검색과 컬렉션 필드 목록에는 이번 관리자 API 업데이트도 필요합니다. 기존 일정 배포 워크플로는 **Firebase functions**라는 이름으로 관리자 API와 일정 함수의 테스트·배포를 함께 수행합니다. 인증 공급자나 서비스 계정 키는 새로 만들지 않습니다.

기존 GitHub 배포 계정이 관리자 API 실행 계정을 사용할 수 있도록, 프로젝트 운영자가 Cloud Shell에서 아래 권한을 **최초 한 번** 연결합니다. 문서 데이터는 변경하지 않습니다.

```bash
gcloud iam service-accounts add-iam-policy-binding \
  firestore-admin-console@alcoholaway.iam.gserviceaccount.com \
  --project=alcoholaway \
  --member=serviceAccount:firebase-github-deploy@alcoholaway.iam.gserviceaccount.com \
  --role=roles/iam.serviceAccountUser \
  --condition=None
```

동일한 작업을 프로젝트 번호와 두 계정의 존재를 확인한 뒤 실행하는 스크립트도 있습니다: `bash firestore-admin/enable-auto-deploy.sh` (저장소 최상위 기준).

PR을 Rollback-version2에 병합하면 GitHub Pages와 Firebase functions가 실행됩니다. 이미 병합했다면 Actions → Firebase functions → Run workflow에서 Rollback-version2를 선택합니다. 관리자 API 단계에 actAs 권한 오류가 나면 위 연결 후 실패한 배포를 다시 실행하세요. 배포 계정은 관리자 API 실행 계정에 대한 Service Account User만 추가로 받고, 문서 관리자 커스텀 클레임은 받지 않습니다.

수동 배포는 최신 브랜치를 받은 저장소의 `firestore-admin` 폴더에서 아래처럼 설정 경로를 명시해 실행합니다. 기존 관리자 UID/클레임을 다시 등록할 필요는 없습니다.

```bash
(
  set -e
  test -f firebase.json
  npm ci --prefix functions
  npm test --prefix functions
  npx --yes firebase-tools@15.31.0 deploy --config ./firebase.json --project alcoholaway --only functions:firestore-admin
)
```
