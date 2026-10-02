# Publication and package verification

The GitHub **v1.4** release distributes package version **1.4.0**; it does **not** publish that package to the npm registry. Registry package availability and maintainer authentication must be established independently: during feature verification, the integration owner observed a registry package 404 and local `npm whoami --registry=https://registry.npmjs.org` returning `ENEEDAUTH`. Those are prerequisites, not reasons to bypass authentication.

## Bootstrap and trusted publishing

If the npm package does not exist, an authorized maintainer must separately approve and perform the initial publish using their authenticated, 2FA-protected npm account. Configure trusted publishing in the package's npm settings only after that package exists. Do not create a token or log credentials as part of these checks.

For subsequent releases configure a GitHub trusted publisher with the exact repository owner/name, workflow filename **`npm-publish.yml`**, and environment **`npm-release`**. Explicitly allow **direct `npm publish`**: newly configured publishers may default to staged publication only. Use GitHub-hosted runners. Enable required reviewers and protected release-tag deployment rules on the `npm-release` GitHub environment; prevent self-approval and protect release tags from replacement. The workflow cannot create or enforce these repository/npm settings itself. Without them the environment name alone is not an approval boundary.

The [official trusted-publishing requirements](https://docs.npmjs.com/trusted-publishers/) are npm >=11.5.1 and Node >=22.14.0. This workflow pins Node **24.0.0**, npm **11.6.0** ([registry record](https://registry.npmjs.org/npm/11.6.0)), Ubuntu 24.04 and existing repository action SHA pins. It uses no release dependency cache, long-lived npm secret, `NODE_AUTH_TOKEN`, or generated credential file. OIDC permission is scoped to the environment-gated release job. Publication requests npm provenance explicitly.

## Review record and manual gates

Before running the workflow:

1. Verify the exact commit, tests, generated JS/declarations/maps, zero-runtime-dependency gate, installed tarball behavior and production Vite worklet deployment. Review packed file contents, license, package metadata and secret exposure. Run dependency audits, including development tooling. Do not equate an audit or passing tests with a complete security review.
2. Record independent A/B/C/D security review findings, resolution of blockers and package verification in the **body** of a public GitHub issue or pull request in the same repository. Include the exact full 40-character commit SHA. The workflow requires these exact affirmative lines (only mark PASS after actual review):

   ```text
   A: PASS
   B: PASS
   C: PASS
   D: PASS
   Package verification: PASS
   ```

   Preserve the supporting findings and commands/results alongside those lines. The workflow checks their presence and commit identity; it cannot judge review quality. The environment approver must inspect the actual record, reviewer independence and any unresolved findings. Do not copy these labels as a substitute for review.
3. Create the protected version tag at that reviewed commit and a published, non-draft, non-prerelease GitHub release. Zero-patch package versions use short tags (`1.3.0` → `v1.3`); nonzero patches retain all components (`1.3.1` → `v1.3.1`). The existing `v1.0`–`v1.3` tags keep their original release commits. Creating a future tag/release is a maintainer action requiring separate authorization.
4. Dispatch **Manual npm release** from that exact tag. Supply the matching package version, reviewed commit SHA and review URL. Default `publish=false` runs all verification and a dry-run, without publication.
5. Only after explicit publication authorization, dispatch with `publish=true` and confirmation **`publish opm.js@VERSION`**, then obtain environment approval. A mismatched version/tag/commit, missing released tag or non-affirmative review fails before installation/publication. Inputs are validated via environment variables, not interpolated into executable JavaScript.

The release job reruns tests/build/type checks, dependency audits, sound-quality and voice-quality checks, installed-package security smoke, actual Chromium browser smoke/stress and the standalone Vite smoke against a locally packed current artifact. It then packs a release tarball, dry-runs that exact tarball, records its SHA-256 digest and review URL in the job summary, and publishes that same file with `--ignore-scripts --provenance`. There is no automatic tag, commit, push, release creation or publication on normal CI/push events. If the version already exists, npm must reject publication; do not delete or overwrite releases to bypass that rejection.

After an authorized publication, verify the registry version, integrity, file list and provenance against the reviewed artifact and retain the run URL/digest in the review record. OIDC configuration, actual environment protection, maintainer authorization and registry provenance are external prerequisites/results and must not be claimed as verified by merely adding this workflow.
