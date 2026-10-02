# Publication and package verification

The GitHub **v1.5** release line distributes package version **1.5.0**; it does **not** publish that package to the npm registry. Registry package availability and maintainer authentication must be established independently: during feature verification, the integration owner observed a registry package 404 and local `npm whoami --registry=https://registry.npmjs.org` returning `ENEEDAUTH`. Those are prerequisites, not reasons to bypass authentication.

The maintainer authorized the v1.5 commit, push, tag and GitHub release after feature verification. Keep the historical v1.4 tag and artifact immutable. Authenticate an authorized npm maintainer before initial registry publication; GitHub authentication does not grant npm authentication. Local installed-tarball checks do not prove registry availability, integrity or provenance.

## No automated npm publication

This repository does not ship a GitHub Actions workflow that publishes to npm. A GitHub release, tag, or passing CI job is not registry publication. An authorized maintainer must authenticate and publish separately; GitHub authentication does not grant npm authentication. Do not create a token or log credentials as part of local checks.

Trusted publishing, npm ownership/2FA, environment reviewers and protected tags are external npm/GitHub settings. They are not configured by files in this checkout.

`registry-verify`'s online provenance check still expects a published SLSA v1 attestation whose workflow path is `.github/workflows/npm-publish.yml`. That identity matches packages published by the removed workflow. A package published another way will fail that check; do not treat a local PASS as a substitute.

## Local and post-publication commands

From a source checkout, validate a reviewed artifact without contacting npm or claiming registry availability:

```sh
npm run registry-verify -- --local /absolute/path/opm.js-1.7.0.tgz 1.7.0
```

After publication, replace the SHA below with the actual reviewed release commit:

```sh
npm run registry-verify -- /absolute/path/opm.js-VERSION.tgz VERSION FULL_40_CHARACTER_COMMIT_SHA
```

The online command is read-only with respect to the registry: it cannot publish, configure trusted publishers or authenticate an account. Downloads have explicit byte/time budgets and are restricted to HTTPS `registry.npmjs.org`; its isolated installation is removed afterwards. It requires `tar`, npm with provenance verification support, and published SLSA v1 GitHub provenance whose workflow path is `.github/workflows/npm-publish.yml`. Retain its digest, file list and run URL in the public review record.

First-package bootstrap, npm ownership/2FA, trusted-publisher configuration, GitHub environment reviewers/protected tags, publication authorization and actual registry verification remain external requirements. Do not substitute a local PASS, stale release review, or manual unprovenanced bootstrap for a verified provenance-bearing release. GitHub release distribution of 1.7.0 does not establish npm registry publication.
