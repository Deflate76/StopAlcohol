#!/usr/bin/env bash
# Run intentionally from Google Cloud Shell with a project administrator account.
set -euo pipefail
readonly admin_project='alcoholaway'
readonly admin_account='firestore-admin-console'
readonly admin_email="${admin_account}@${admin_project}.iam.gserviceaccount.com"
command -v gcloud >/dev/null
gcloud projects describe "$admin_project" --format='value(projectId)'
admin_error_file=$(mktemp)
trap 'rm -f "$admin_error_file"' EXIT

if gcloud iam service-accounts describe "$admin_email" --project "$admin_project" >/dev/null 2>"$admin_error_file"; then
  printf '%s\n' '기존 관리자 API 실행 계정을 사용합니다.'
else
  admin_error=$(<"$admin_error_file")
  # Do not mistake a permissions/configuration failure for an absent account.
  if [[ "$admin_error" != *NOT_FOUND* && "$admin_error" != *'does not exist'* ]]; then
    printf '%s\n' "$admin_error" >&2
    exit 1
  fi
  if gcloud iam service-accounts create "$admin_account" --project "$admin_project" --display-name='Firestore admin console runtime' 2>"$admin_error_file"; then
    printf '%s\n' '실행 계정을 만들었습니다. IAM 반영을 확인하며 권한을 설정합니다.'
  else
    admin_error=$(<"$admin_error_file")
    # A previously created account may still be invisible to the read API.
    if [[ "$admin_error" != *ALREADY_EXISTS* && "$admin_error" != *'already exists'* ]]; then
      printf '%s\n' "$admin_error" >&2
      exit 1
    fi
  fi
fi

grant_runtime_role() {
  local role="$1" attempt=1 delay=2 wait_seconds last_error
  while true; do
    if gcloud projects add-iam-policy-binding "$admin_project" --member="serviceAccount:${admin_email}" --role="$role" --condition=None --quiet --format=none 2>"$admin_error_file"; then
      printf '권한 설정 완료: %s\n' "$role"
      return 0
    fi
    last_error=$(<"$admin_error_file")
    # Repeat the whole read/modify/write operation, only for known transient errors.
    if [[ "$last_error" != *"Service account ${admin_email} does not exist"* &&
          "$last_error" != *ABORTED* && "$last_error" != *UNAVAILABLE* &&
          "$last_error" != *DEADLINE_EXCEEDED* && "$last_error" != *INTERNAL* ]]; then
      printf '%s\n' "$last_error" >&2
      return 1
    fi
    if (( attempt >= 9 )); then
      printf '%s\n' "$last_error" >&2
      printf '%s\n' '재시도 한도에 도달했습니다. 계정 상태와 위 오류를 확인한 뒤 다시 실행하세요.' >&2
      return 1
    fi
    wait_seconds=$((delay + RANDOM % 3))
    printf 'IAM 반영 대기: %s · %s초 후 재시도 (%s/9)\n' "$role" "$wait_seconds" "$attempt"
    sleep "$wait_seconds"
    attempt=$((attempt + 1))
    if (( delay < 32 )); then delay=$((delay * 2)); fi
  done
}

grant_runtime_role 'roles/datastore.user'
grant_runtime_role 'roles/firebaseauth.viewer'
printf '%s\n' '관리자 API 전용 실행 계정을 준비했습니다. 아직 함수 배포나 관리자 지정은 하지 않았습니다.'
