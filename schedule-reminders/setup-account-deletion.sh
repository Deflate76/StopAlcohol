#!/usr/bin/env bash
# One-time setup by a project IAM administrator. No keys, Owner grants, or rule replacement.
set -euo pipefail
ACCOUNT_PROJECT=alcoholaway
ACCOUNT_RUNTIME=daily-schedules-runtime@alcoholaway.iam.gserviceaccount.com
ACCOUNT_BUCKET=gs://alcoholaway.firebasestorage.app
command -v gcloud >/dev/null || { echo 'Google Cloud CLI is required. Run this script in Cloud Shell.' >&2; exit 1; }
ensure_role() {
  local name="$1" permissions="$2" title="$3"
  if gcloud iam roles describe "$name" --project="$ACCOUNT_PROJECT" >/dev/null 2>&1; then
    gcloud iam roles update "$name" --project="$ACCOUNT_PROJECT" --permissions="$permissions" --title="$title" --stage=GA --quiet >/dev/null
  else
    gcloud iam roles create "$name" --project="$ACCOUNT_PROJECT" --permissions="$permissions" --title="$title" --stage=GA --quiet >/dev/null
  fi
}
ensure_role alcoholawayAccountDeletion 'firebaseauth.users.get,firebaseauth.users.update,firebaseauth.users.delete' 'Alcoholaway account deletion'
ensure_role alcoholawayPhotoDeletion 'storage.objects.list,storage.objects.delete' 'Alcoholaway personal photo deletion'
gcloud projects add-iam-policy-binding "$ACCOUNT_PROJECT" --member="serviceAccount:$ACCOUNT_RUNTIME" --role="projects/$ACCOUNT_PROJECT/roles/alcoholawayAccountDeletion" --condition=None --quiet --format=none
gcloud storage buckets add-iam-policy-binding "$ACCOUNT_BUCKET" --member="serviceAccount:$ACCOUNT_RUNTIME" --role="projects/$ACCOUNT_PROJECT/roles/alcoholawayPhotoDeletion" --quiet >/dev/null
echo 'Account deletion permissions configured.'
