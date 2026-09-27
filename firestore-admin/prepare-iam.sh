#!/usr/bin/env bash
# Run intentionally from Google Cloud Shell with a project administrator account.
set -euo pipefail
readonly admin_project='alcoholaway'
readonly admin_account='firestore-admin-console'
readonly admin_email="${admin_account}@${admin_project}.iam.gserviceaccount.com"
command -v gcloud >/dev/null
gcloud projects describe "$admin_project" --format='value(projectId)'
if ! gcloud iam service-accounts describe "$admin_email" --project "$admin_project" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$admin_account" --project "$admin_project" --display-name='Firestore admin console runtime'
fi
gcloud projects add-iam-policy-binding "$admin_project" --member="serviceAccount:${admin_email}" --role='roles/datastore.user' --condition=None --quiet
gcloud projects add-iam-policy-binding "$admin_project" --member="serviceAccount:${admin_email}" --role='roles/firebaseauth.viewer' --condition=None --quiet
printf '%s\n' '관리자 API 전용 실행 계정을 준비했습니다. 아직 함수 배포나 관리자 지정은 하지 않았습니다.'
