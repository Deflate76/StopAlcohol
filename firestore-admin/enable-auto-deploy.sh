#!/usr/bin/env bash
# Extend the existing GitHub deploy identity to this existing runtime account only.
set -euo pipefail
readonly admin_deploy_project='alcoholaway'
readonly admin_runtime='firestore-admin-console@alcoholaway.iam.gserviceaccount.com'
readonly admin_deployer='firebase-github-deploy@alcoholaway.iam.gserviceaccount.com'
command -v gcloud >/dev/null
admin_project_number=$(gcloud projects describe "$admin_deploy_project" --format='value(projectNumber)')
if [[ "$admin_project_number" != '1001199235857' ]]; then
  printf '%s\n' '프로젝트 번호가 다릅니다. 권한을 변경하지 않았습니다.' >&2
  exit 1
fi
gcloud iam service-accounts describe "$admin_runtime" --project="$admin_deploy_project" >/dev/null
gcloud iam service-accounts describe "$admin_deployer" --project="$admin_deploy_project" >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$admin_runtime" \
  --project="$admin_deploy_project" \
  --member="serviceAccount:$admin_deployer" \
  --role=roles/iam.serviceAccountUser --condition=None --quiet --format=none
printf '%s\n' '관리자 API의 GitHub 자동 배포 권한을 연결했습니다. Firebase functions 워크플로를 실행하세요.'
