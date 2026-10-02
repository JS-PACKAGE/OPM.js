# Publication and package verification

The [GitHub v1.8 release](https://github.com/YueyuHoshizora/OPM.js/releases/tag/v1.8) distributes package **1.8.0**; it does **not** publish to npm. Download its [installable `opm.js-1.8.0.tgz`](https://github.com/YueyuHoshizora/OPM.js/releases/download/v1.8/opm.js-1.8.0.tgz) and install it from an application with `npm install /actual/path/to/opm.js-1.8.0.tgz`, without building or installing development tools.

The published tag points to `d793d69056c68a971ede1af988338412687227fd`. The attached archive is 491,851 bytes, with SHA-256 `bee862d5b3ccaa7c4e8ff959583873c78a8ca8a9f56f4d8b039e490e498e2587`; it was built from that tag, installed/exercised, and downloaded back byte-for-byte. Its original documentation remains unchanged. These synchronized checkout docs describe the same public v1.8 contracts; a newly packed checkout is a different artifact and must not be represented as the verified release archive. Preserve existing tags and assets.

## No automated npm publication

This repository does not ship a GitHub Actions workflow that publishes to npm. A GitHub release, tag, or passing CI job is not registry publication. An authorized maintainer must authenticate and publish separately; GitHub authentication does not grant npm authentication. Do not create a token or log credentials as part of local checks.

Trusted publishing, npm ownership/2FA, environment reviewers and protected tags are external npm/GitHub settings. They are not configured by files in this checkout.

`registry-verify`'s online provenance check still requires a published SLSA v1 attestation whose workflow identity is `.github/workflows/npm-publish.yml`, matching the removed workflow's intended identity. This is not evidence that any package was published by it. A package published another way will fail that check. A future publication needs an explicitly authorized provenance-bearing path and a matching reviewed verifier; do not bypass the check or treat local validation as registry acceptance.

## Local and post-publication commands

From a source checkout, validate a reviewed artifact without contacting npm or claiming registry availability:

```sh
npm run registry-verify -- --local /absolute/path/opm.js-1.8.0.tgz 1.8.0
```

After publication, replace the SHA below with the actual reviewed release commit:

```sh
npm run registry-verify -- /absolute/path/opm.js-VERSION.tgz VERSION FULL_40_CHARACTER_COMMIT_SHA
```

The online command is read-only with respect to the registry: it cannot publish, configure trusted publishers or authenticate an account. Downloads have explicit byte/time budgets and are restricted to HTTPS `registry.npmjs.org`; its isolated installation is removed afterwards. It requires `tar`, npm with provenance verification support, and published SLSA v1 GitHub provenance whose workflow path is `.github/workflows/npm-publish.yml`. Retain its digest, file list and run URL in the public review record.

First-package bootstrap, npm ownership/2FA, trusted-publisher configuration, GitHub environment reviewers/protected tags, publication authorization and actual registry verification remain external requirements. The public registry returned 404 for `opm.js@1.8.0` during the package audit; registry integrity/signatures/provenance therefore remain unverified. Do not substitute a local PASS, stale release review, or manual unprovenanced bootstrap for a verified provenance-bearing publication. GitHub distribution of 1.8.0 does not establish npm publication. Run the [security review and package gates](../SECURITY.md#security-review-mechanism) against the exact candidate before any newly authorized release.
