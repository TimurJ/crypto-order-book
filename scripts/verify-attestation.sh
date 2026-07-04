#!/usr/bin/env bash
#
# verify-attestation.sh — assert every built file under <dir> carries valid SLSA build provenance
# attested to <repo>, before a deploy promotes it. Called by .github/workflows/cd.yml in each deploy
# job (dev/uat/prod) after the build-once dist-<sha> artifact is downloaded and before the Worker
# version is uploaded, so a build with any unattested file never gets promoted. The build job attests
# `dist/**/*`; verify matches each file by digest against the repo's (public) attestations that were
# signed by the cd.yml build workflow (`--signer-workflow`), fetched with GH_TOKEN. Exits non-zero
# with a ::error:: annotation on the first file that fails.
#
# Usage:  bash scripts/verify-attestation.sh <dir> <repo>
#   <dir>   directory of built files to verify, e.g. dist
#   <repo>  owner/name the attestation is bound to, e.g. "$GITHUB_REPOSITORY"
set -euo pipefail

usage="usage: bash scripts/verify-attestation.sh <dir> <repo>"
dir="${1:?$usage}"
repo="${2:?$usage}"

# Verify one file, retrying a few times: a freshly minted attestation can lag a few seconds in the API
# (the same-run DEV deploy), and a transient edge/API blip shouldn't fail a whole deploy.
verify_one() {
  local f="$1" n
  for n in 1 2 3; do
    gh attestation verify "$f" --repo "$repo" \
      --signer-workflow "$repo/.github/workflows/cd.yml" >/dev/null 2>&1 && return 0
    [ "$n" -lt 3 ] && sleep 5
  done
  echo "::error::attestation verify failed for $f (repo $repo)"
  return 1
}

count=0
while IFS= read -r -d '' f; do
  verify_one "$f" || exit 1
  count=$((count + 1))
done < <(find "$dir" -type f -print0)

[ "$count" -gt 0 ] || { echo "::error::no files under $dir to verify"; exit 1; }
echo "Provenance OK: $count files verified against $repo"
