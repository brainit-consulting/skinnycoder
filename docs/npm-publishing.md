# Publishing SkinnyCoder to npm

This guide is for maintainers publishing `skinnycoder` through the repository's
tokenless GitHub Actions workflow. It does not change the CLI or release
workflow.

## Choose the installation source

- **npm install:** `npm install -g skinnycoder` installs npm's current `latest`
  release. Use this for ordinary installations.
- **GitHub source install:** clone the
  [SkinnyCoder repository](https://github.com/brainit-consulting/skinnycoder),
  run `npm ci`, `npm run build`, and `npm link`. This links the global command to
  a mutable local checkout, so rebuild after pulling or editing source.

The two methods are not interchangeable: a GitHub clone is source code, while
an npm install is a packaged release.

## Initial npm bootstrap

npm requires a package to exist before a trusted publisher can be attached.
SkinnyCoder has completed this bootstrap: `skinnycoder@0.2.2` is published and
must not be published again. For a brand-new package, the initial steps are:

1. Create or sign in to the npm owner account and enable account-level 2FA with
   an authenticator or passkey.
2. From a clean, reviewed checkout, confirm the package version has never been
   published.
3. Authenticate locally, confirm the account, and publish the first public
   version:

   ```bash
   npm login
   npm whoami
   npm publish --access public
   ```

Do not record passwords, passkeys, recovery codes, one-time codes, or tokens in
this repository, GitHub Actions, terminal transcripts, or this guide.

## Configure npm trusted publishing

In the SkinnyCoder npm package settings, verify or add a GitHub Actions trusted
publisher with these exact values:

| Setting | Value |
| --- | --- |
| Organization or user | `brainit-consulting` |
| Repository | `skinnycoder` |
| Workflow filename | `publish-npm.yml` |
| Environment | Leave blank |
| Allowed action | `npm publish` |

The filename must match
[`publish-npm.yml`](../.github/workflows/publish-npm.yml) exactly. The workflow
uses npm OIDC and does not require an `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret.

After one OIDC release succeeds, set npm **Publishing access** to **Require two-factor
authentication and disallow tokens**. Trusted publishing continues to work
because it uses short-lived OIDC credentials rather than registry tokens.

See npm's official [trusted publishing guide](https://docs.npmjs.com/trusted-publishers/)
and [`npm trust` prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/).

## Routine release

The tag is the intentional publish trigger. Pushing `main` alone does not
publish anything.

1. Start from a clean `main` synchronized with `origin/main`.
2. Choose a new, unused semantic version and update `package.json` and
   `package-lock.json`.
3. If user-visible release information changes, update both
   [`README.md`](../README.md) and [`skinnycoder.html`](../skinnycoder.html) in
   the same change.
4. Install reproducibly and verify the release:

   ```bash
   npm ci
   npm run build
   npm test
   npm pack --dry-run --ignore-scripts
   ```

5. Review the diff, commit only the intended release files, and push `main`.
6. Create and push the tag that exactly matches `package.json`:

   ```bash
   git tag -a vX.Y.Z -m "Release SkinnyCoder vX.Y.Z"
   git push origin vX.Y.Z
   ```

7. In GitHub Actions, confirm **Publish npm package** completes its verify and
   OIDC publish jobs. Then confirm the exact version on npm.

## Do not

- Do not republish or reuse an existing version. npm versions are immutable.
- Do not store or add a long-lived `NPM_TOKEN`; the release workflow is OIDC-only.
- Do not push a release tag before tests pass and npm trusted publishing is
  configured.
- Do not use a tag that differs from `v<package.json version>` or points outside
  `main`; the workflow intentionally rejects both cases.
- Do not include credentials, tokens, passkeys, recovery codes, or personal
  account information in commits, issues, logs, or documentation.

## Troubleshooting

- **`E404` for a package during bootstrap:** the package does not yet exist.
  Complete its first manual public publish, then configure the trusted
  publisher. SkinnyCoder itself should no longer return this error.
- **`ENEEDAUTH` from local `npm whoami` or `npm publish`:** the local shell is not
  logged in. This is separate from GitHub OIDC; `npm whoami` does not test the
  workflow's trusted identity.
- **`ENEEDAUTH` in GitHub Actions:** verify the npm trusted-publisher owner,
  repository, and workflow filename exactly match the table above, the allowed
  action includes `npm publish`, and the publish job still has `id-token: write`.
- **Workflow does not start:** it runs only when a matching `vX.Y.Z` tag is
  pushed. A normal branch push intentionally creates no run.
- **Release identity check fails:** make the tag exactly match `package.json`
  and ensure the tagged commit is contained in `origin/main`.
- **Trusted-publishing toolchain check fails:** npm OIDC requires npm 11.5.1 or
  newer; keep the workflow on its supported Node/npm toolchain.
- **Version already exists / publish is rejected:** choose a new version, update
  the lockfile and paired release documentation as needed, retest, and create a
  new matching tag. Never force or recycle the old tag/version.
- **`npm ci` reports lockfile drift:** regenerate and review `package-lock.json`
  from the intended dependency change before releasing; do not substitute
  `npm install` inside the release workflow.
