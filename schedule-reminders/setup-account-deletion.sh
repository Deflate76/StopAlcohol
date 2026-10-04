#!/usr/bin/env bash
# One-time setup by a project IAM administrator. No keys or rule replacement.
set -euo pipefail
readonly ACCOUNT_PROJECT=alcoholaway
readonly ACCOUNT_EXPECTED_NUMBER=1001199235857
readonly ACCOUNT_RUNTIME=daily-schedules-runtime@alcoholaway.iam.gserviceaccount.com
readonly ACCOUNT_BUCKET=gs://alcoholaway.firebasestorage.app
readonly ACCOUNT_PHOTO_ROLE=projects/alcoholaway/roles/alcoholawayPhotoDeletion
readonly ACCOUNT_BUCKET_RESOURCE=projects/_/buckets/alcoholaway.firebasestorage.app
ACCOUNT_STORAGE_ONLY=false
case "${1:-}" in
  '') ;;
  --storage-only) ACCOUNT_STORAGE_ONLY=true ;;
  *) echo 'Usage: bash setup-account-deletion.sh [--storage-only]' >&2; exit 2 ;;
esac
if (( $# > 1 )); then echo 'Too many arguments.' >&2; exit 2; fi
command -v gcloud >/dev/null || { echo 'Google Cloud CLI is required. Run this script in Cloud Shell.' >&2; exit 1; }
command -v python3 >/dev/null || { echo 'Python 3 is required. Run this script in Cloud Shell.' >&2; exit 1; }

# A role from a different project cannot be granted on this bucket. Verify the
# numeric owner before changing any IAM policy; bucket names alone are not proof.
ACCOUNT_PROJECT_NUMBER=$(gcloud projects describe "$ACCOUNT_PROJECT" --format='value(projectNumber)')
if [[ "$ACCOUNT_PROJECT_NUMBER" != "$ACCOUNT_EXPECTED_NUMBER" ]]; then
  echo "Project identity mismatch: expected $ACCOUNT_EXPECTED_NUMBER, got $ACCOUNT_PROJECT_NUMBER. No IAM policy changed." >&2
  exit 1
fi
ACCOUNT_BUCKET_NUMBER=$(gcloud storage buckets describe "$ACCOUNT_BUCKET" --raw --format='value(projectNumber)' --project="$ACCOUNT_PROJECT")
if [[ "$ACCOUNT_BUCKET_NUMBER" != "$ACCOUNT_PROJECT_NUMBER" ]]; then
  echo "Bucket project mismatch: $ACCOUNT_BUCKET belongs to $ACCOUNT_BUCKET_NUMBER, expected $ACCOUNT_PROJECT_NUMBER. No IAM policy changed." >&2
  exit 1
fi
ACCOUNT_ERROR_FILE=$(mktemp)
trap 'rm -f "$ACCOUNT_ERROR_FILE"' EXIT

ensure_role() {
  local name="$1" permissions="$2" title="$3" metadata
  if metadata=$(gcloud iam roles describe "$name" --project="$ACCOUNT_PROJECT" --format=json 2>"$ACCOUNT_ERROR_FILE"); then
    # Reuse correct existing roles without resetting other administrator edits.
    if ! python3 -c 'import json,sys; r=json.load(sys.stdin); sys.exit(0 if set(r.get("includedPermissions",[]))==set(sys.argv[1].split(",")) and not r.get("deleted") and r.get("stage")!="DISABLED" else 1)' "$permissions" <<<"$metadata"; then
      echo "Existing role $name has unexpected permissions or is disabled. Review it before granting it; no role was overwritten." >&2
      exit 1
    fi
  elif grep -Eqi 'NOT_FOUND|does not exist|not found' "$ACCOUNT_ERROR_FILE"; then
    gcloud iam roles create "$name" --project="$ACCOUNT_PROJECT" --permissions="$permissions" --title="$title" --stage=GA --quiet >/dev/null
  else
    cat "$ACCOUNT_ERROR_FILE" >&2
    echo 'Cannot inspect the role. Use a project IAM administrator account.' >&2
    exit 1
  fi
}

grant_project_role() {
  local role="$1" condition="$2" attempt
  for attempt in {1..13}; do
    if gcloud projects add-iam-policy-binding "$ACCOUNT_PROJECT" --member="serviceAccount:$ACCOUNT_RUNTIME" --role="$role" --condition="$condition" --quiet --format=none 2>"$ACCOUNT_ERROR_FILE"; then
      return 0
    fi
    # IAM propagation may lag role creation. Never retry permission denials or
    # replace a narrowly scoped custom role with a broader predefined role.
    if (( attempt == 13 )) || ! grep -Eqi 'does not exist in the resource.*hierarchy' "$ACCOUNT_ERROR_FILE"; then
      cat "$ACCOUNT_ERROR_FILE" >&2
      echo 'IAM binding was not completed. Existing successful settings were preserved.' >&2
      return 1
    fi
    echo 'Waiting 10 seconds for the new custom role to become available...' >&2
    sleep 10
  done
}

if [[ "$ACCOUNT_STORAGE_ONLY" == false ]]; then
  ensure_role alcoholawayAccountDeletion 'firebaseauth.users.get,firebaseauth.users.update,firebaseauth.users.delete' 'Alcoholaway account deletion'
  grant_project_role "projects/$ACCOUNT_PROJECT/roles/alcoholawayAccountDeletion" None
fi
ensure_role alcoholawayPhotoDeletion 'storage.objects.list,storage.objects.delete' 'Alcoholaway personal photo deletion'
# Bind the project custom role in its defining project. Inheritance applies only
# to this bucket's list operation and the two personal-photo object prefixes.
# Do not change bucket ACLs, uniform access settings, or unrelated IAM bindings.
ACCOUNT_PHOTO_CONDITION="title=alcoholaway_member_photos_only_v1,expression=resource.name == '$ACCOUNT_BUCKET_RESOURCE' || resource.name.startsWith('$ACCOUNT_BUCKET_RESOURCE/objects/health_records/') || resource.name.startsWith('$ACCOUNT_BUCKET_RESOURCE/objects/pill_identification/')"
grant_project_role "$ACCOUNT_PHOTO_ROLE" "$ACCOUNT_PHOTO_CONDITION"
echo 'Photo deletion IAM binding saved. Access is limited to the member-photo bucket and photo paths.'
echo 'IAM propagation can take a few minutes. This setup script does not delete any member or photo.'
