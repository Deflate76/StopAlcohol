#!/usr/bin/env bash
# Run once in an authenticated Cloud Shell. Creates no service-account keys.
set -euo pipefail

readonly SCHEDULE_PROJECT='alcoholaway'
readonly SCHEDULE_EXPECTED_NUMBER='1001199235857'
readonly SCHEDULE_REGION='asia-northeast3'
readonly SCHEDULE_REPO_ID='1207749530'
readonly SCHEDULE_OWNER_ID='233573528'
readonly SCHEDULE_POOL='alcoholaway-github'
readonly SCHEDULE_PROVIDER='stopalcohol'
readonly SCHEDULE_DEPLOY_ACCOUNT="firebase-github-deploy@${SCHEDULE_PROJECT}.iam.gserviceaccount.com"
readonly SCHEDULE_RUNTIME_ACCOUNT="daily-schedules-runtime@${SCHEDULE_PROJECT}.iam.gserviceaccount.com"
readonly SCHEDULE_WORKFLOW='Deflate76/StopAlcohol/.github/workflows/deploy-firebase-functions.yml@refs/heads/Rollback-version2'

command -v gcloud >/dev/null || { echo 'Google Cloud Shell에서 실행해 주세요.' >&2; exit 1; }
command -v python3 >/dev/null || { echo 'python3가 필요합니다.' >&2; exit 1; }
SCHEDULE_PROJECT_NUMBER=$(gcloud projects describe "$SCHEDULE_PROJECT" --format='value(projectNumber)')
readonly SCHEDULE_PROJECT_NUMBER
if [[ "$SCHEDULE_PROJECT_NUMBER" != "$SCHEDULE_EXPECTED_NUMBER" ]]; then
  echo '프로젝트 번호가 저장소의 Firebase 설정과 다릅니다. 변경 없이 중단합니다.' >&2
  exit 1
fi

echo 'alcoholaway: GitHub 자동 배포 인증과 함수 실행 권한을 설정합니다.'
echo '대상: Deflate76/StopAlcohol / Rollback-version2 / 일정 함수 배포 워크플로'
gcloud services enable \
  iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  cloudresourcemanager.googleapis.com serviceusage.googleapis.com \
  cloudfunctions.googleapis.com run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com cloudscheduler.googleapis.com \
  eventarc.googleapis.com pubsub.googleapis.com storage.googleapis.com \
  firestore.googleapis.com fcm.googleapis.com firebase.googleapis.com \
  --project="$SCHEDULE_PROJECT" --quiet

ensure_service_account() {
  local account_id="$1" account_email="$2" display_name="$3"
  if ! gcloud iam service-accounts describe "$account_email" --project="$SCHEDULE_PROJECT" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$account_id" --display-name="$display_name" --project="$SCHEDULE_PROJECT" --quiet
  fi
}
grant_project_role() {
  gcloud projects add-iam-policy-binding "$SCHEDULE_PROJECT" \
    --member="serviceAccount:$1" --role="$2" --condition=None --quiet >/dev/null
}
allow_deployer_to_act_as() {
  gcloud iam service-accounts add-iam-policy-binding "$1" \
    --member="serviceAccount:$SCHEDULE_DEPLOY_ACCOUNT" \
    --role=roles/iam.serviceAccountUser --project="$SCHEDULE_PROJECT" --quiet >/dev/null
}

ensure_service_account firebase-github-deploy "$SCHEDULE_DEPLOY_ACCOUNT" 'GitHub schedule function deployer'
ensure_service_account daily-schedules-runtime "$SCHEDULE_RUNTIME_ACCOUNT" 'Daily schedule function runtime'

# Deployment and runtime accounts are distinct; the workflow never receives an Owner key.
for role in roles/cloudfunctions.admin roles/run.admin roles/cloudscheduler.admin \
            roles/serviceusage.serviceUsageAdmin roles/firebase.viewer; do
  grant_project_role "$SCHEDULE_DEPLOY_ACCOUNT" "$role"
done
for role in roles/datastore.user roles/firebasecloudmessaging.admin; do
  grant_project_role "$SCHEDULE_RUNTIME_ACCOUNT" "$role"
done
allow_deployer_to_act_as "$SCHEDULE_RUNTIME_ACCOUNT"

# The administrator codebase has a separate, already provisioned runtime identity.
if gcloud iam service-accounts describe 'firestore-admin-console@alcoholaway.iam.gserviceaccount.com' \
  --project="$SCHEDULE_PROJECT" >/dev/null 2>&1; then
  allow_deployer_to_act_as 'firestore-admin-console@alcoholaway.iam.gserviceaccount.com'
fi

# Firebase CLI 15.31.0 checks the App Engine default account even for Gen 2.
# Scope actAs to that account when it exists, instead of every project account.
if gcloud iam service-accounts describe "${SCHEDULE_PROJECT}@appspot.gserviceaccount.com" \
  --project="$SCHEDULE_PROJECT" >/dev/null 2>&1; then
  allow_deployer_to_act_as "${SCHEDULE_PROJECT}@appspot.gserviceaccount.com"
fi

# Ensure Scheduler can mint the OIDC token used to invoke the scheduled function.
gcloud beta services identity create --service=cloudscheduler.googleapis.com --project="$SCHEDULE_PROJECT" --quiet
grant_project_role "service-${SCHEDULE_PROJECT_NUMBER}@gcp-sa-cloudscheduler.iam.gserviceaccount.com" roles/cloudscheduler.serviceAgent

# New projects may use the Compute default account for Cloud Build. Older projects
# can use the Google-owned legacy Cloud Build account, whose IAM policy cannot be edited.
SCHEDULE_BUILD_RESOURCE=$(gcloud builds get-default-service-account --region="$SCHEDULE_REGION" --project="$SCHEDULE_PROJECT")
SCHEDULE_BUILD_ACCOUNT="${SCHEDULE_BUILD_RESOURCE##*/}"
if [[ "$SCHEDULE_BUILD_ACCOUNT" == "${SCHEDULE_PROJECT_NUMBER}-compute@developer.gserviceaccount.com" ]]; then
  grant_project_role "$SCHEDULE_BUILD_ACCOUNT" roles/cloudbuild.builds.builder
  allow_deployer_to_act_as "$SCHEDULE_BUILD_ACCOUNT"
elif [[ "$SCHEDULE_BUILD_ACCOUNT" == "${SCHEDULE_PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" ]]; then
  grant_project_role "$SCHEDULE_BUILD_ACCOUNT" roles/cloudbuild.builds.builder
else
  echo '기본 Cloud Build 서비스 계정이 예상 형식과 다릅니다. 프로젝트 빌드 설정을 확인해 주세요.' >&2
  exit 1
fi

SCHEDULE_EXISTING_POOL=$(gcloud iam workload-identity-pools describe "$SCHEDULE_POOL" \
  --location=global --project="$SCHEDULE_PROJECT" --format=json 2>/dev/null) || SCHEDULE_EXISTING_POOL=''
if [[ -z "$SCHEDULE_EXISTING_POOL" ]]; then
  gcloud iam workload-identity-pools create "$SCHEDULE_POOL" \
    --location=global --display-name='AlcoholAway GitHub deployments' --project="$SCHEDULE_PROJECT" --quiet
else
  SCHEDULE_POOL_JSON="$SCHEDULE_EXISTING_POOL" python3 - <<'PY'
import json, os, sys
p = json.loads(os.environ['SCHEDULE_POOL_JSON'])
if p.get('disabled') or p.get('state') != 'ACTIVE':
    sys.exit('기존 인증 풀이 활성 상태가 아닙니다. 운영자가 확인해 주세요.')
PY
fi

readonly SCHEDULE_MAPPING='google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref,attribute.event_name=assertion.event_name,attribute.workflow_ref=assertion.workflow_ref'
readonly SCHEDULE_CONDITION="assertion.repository_id == '${SCHEDULE_REPO_ID}' && assertion.repository_owner_id == '${SCHEDULE_OWNER_ID}' && assertion.ref == 'refs/heads/Rollback-version2' && assertion.workflow_ref == '${SCHEDULE_WORKFLOW}' && (assertion.event_name == 'push' || assertion.event_name == 'workflow_dispatch')"

SCHEDULE_EXISTING_PROVIDER=$(gcloud iam workload-identity-pools providers describe "$SCHEDULE_PROVIDER" \
  --workload-identity-pool="$SCHEDULE_POOL" --location=global --project="$SCHEDULE_PROJECT" --format=json 2>/dev/null) || SCHEDULE_EXISTING_PROVIDER=''
if [[ -z "$SCHEDULE_EXISTING_PROVIDER" ]]; then
  gcloud iam workload-identity-pools providers create-oidc "$SCHEDULE_PROVIDER" \
    --workload-identity-pool="$SCHEDULE_POOL" --location=global --project="$SCHEDULE_PROJECT" \
    --display-name='StopAlcohol schedule workflow' \
    --issuer-uri='https://token.actions.githubusercontent.com' \
    --attribute-mapping="$SCHEDULE_MAPPING" --attribute-condition="$SCHEDULE_CONDITION" --quiet
else
  # Do not silently replace a pre-existing trust configuration.
  SCHEDULE_PROVIDER_JSON="$SCHEDULE_EXISTING_PROVIDER" SCHEDULE_REQUIRED_CONDITION="$SCHEDULE_CONDITION" \
  SCHEDULE_REQUIRED_MAPPING="$SCHEDULE_MAPPING" python3 - <<'PY'
import json, os, sys
p = json.loads(os.environ['SCHEDULE_PROVIDER_JSON'])
mapping = dict(part.split('=', 1) for part in os.environ['SCHEDULE_REQUIRED_MAPPING'].split(','))
if (p.get('disabled') or p.get('state') != 'ACTIVE'
    or p.get('oidc', {}).get('issuerUri') != 'https://token.actions.githubusercontent.com'
    or p.get('oidc', {}).get('allowedAudiences')
    or p.get('attributeCondition') != os.environ['SCHEDULE_REQUIRED_CONDITION']
    or p.get('attributeMapping') != mapping):
    sys.exit('기존 인증 공급자 설정이 다릅니다. 기존 조건을 덮어쓰지 않았습니다. 운영자가 확인해 주세요.')
PY
fi

gcloud iam service-accounts add-iam-policy-binding "$SCHEDULE_DEPLOY_ACCOUNT" \
  --project="$SCHEDULE_PROJECT" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${SCHEDULE_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${SCHEDULE_POOL}/attribute.repository_id/${SCHEDULE_REPO_ID}" \
  --quiet >/dev/null

cat <<'DONE'

최초 연결 설정을 완료했습니다. 서비스 계정 키 파일이나 GitHub Secret 등록은 필요 없습니다.
권한 전파에는 몇 분 걸릴 수 있습니다.
PR #1을 Rollback-version2에 병합하면 GitHub Actions가 테스트 후 일정 함수를 배포합니다.
이미 병합했다면 GitHub → Actions → Firebase functions → Run workflow를 실행하세요.
이 스크립트 자체는 함수 배포, PR 병합, Firestore 규칙 변경을 실행하지 않습니다.
DONE
