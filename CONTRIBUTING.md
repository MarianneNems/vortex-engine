# Contributing to vortex-engine

This is the production backend for VORTEX ARTEC — Solana minting, USDC
payments, royalty distribution, AI orchestration. Changes here ship to
Railway on merge to `main` and affect live on-chain transactions. Read
this in full before opening a pull request.

This is a **private repository**. Access is by invitation. If you are
reading this from inside the repo, you have commit access; act
accordingly.

---

## Quick start

```bash
git clone git@github.com:MarianneNems/vortex-engine.git
cd vortex-engine
npm install
cp .env.example .env   # ask the maintainer for the real values
npm run dev            # ts-node-dev, watches src/, restarts on save
```

`npm run dev` runs against the same Solana RPC, Pinata, NFT.storage,
Anthropic, OpenAI, RunPod, and Replicate accounts that production uses.
**Default to devnet** for any blockchain test — never test mint or
transfer flows against mainnet from a dev machine.

---

## Branching

| Branch       | Purpose                                              |
| ------------ | ---------------------------------------------------- |
| `main`       | Production. Railway auto-deploys from this branch.   |
| `feat/*`     | New features. Branch from `main`, PR back to `main`. |
| `fix/*`      | Bug fixes. Same flow.                                |
| `chore/*`    | Tooling, deps, build, docs.                          |

There are no long-lived release branches and no LTS. If you need to roll
back, revert the offending commit on `main`.

Never push directly to `main`. Always go through a PR — even for one-line
fixes — so the build + lint + audit checks run.

---

## Commit messages

Use Conventional Commits. The first line is the contract:

```
<type>(<scope>): <imperative subject>

<body — what changed and WHY, not what>

<footer — issue refs, breaking changes, co-authors>
```

Allowed `<type>` values:

- `feat` — user-visible new capability
- `fix` — user-visible bug fix
- `perf` — performance improvement, no behavior change
- `refactor` — internal restructure, no behavior change
- `docs` — README, SECURITY, CONTRIBUTING, inline docblocks
- `test` — adding or fixing tests
- `chore` — build, deps, tooling, CI

Allowed `<scope>` values are the route or service name, lowercase: `tola`,
`tola-compat`, `royalty`, `nft-mint`, `storyboard`, `wp-webhooks`,
`treasury`, `usdc`, `marketplace`, `deps`, `ci`, `docs`.

**Subject rules:** imperative ("add x", not "added x" or "adds x"),
under 72 characters, no trailing period, no emojis.

**Body rules:** explain *why* the change is needed and *what* the user
sees afterward. Don't restate the diff — reviewers can read the diff.
Wrap at 80 columns.

Examples:

```
feat(storyboard): add /api/storyboard/compose FFmpeg pipeline

The WP-side Vortex_Storyboard_Orchestrator falls back to this engine
route when no dedicated RunPod FFmpeg endpoint is configured. Engine
already runs Node, has the local-file storage URL pattern, and avoids
spinning a new RunPod template.
```

```
fix(tola-compat): handle ComfyUI image-array response shape

ComfyUI 5.8.5 returns output.images[0].data (object). The pollers
expected output.image (string). Multi-shape normalizer added so the
WP path saves the base64 correctly regardless of which worker
responded.
```

---

## Pull requests

Every PR must:

1. Branch off the latest `main`. Rebase, don't merge, to stay current.
2. Pass `npm run build` locally — TypeScript must compile clean.
3. Pass `npm run lint` — zero new ESLint errors.
4. Pass `npm test` if you touched anything under `services/` or
   `middleware/`.
5. Include a short description that answers: what changed, why it
   changed, how to test it on devnet.
6. Reference the GitHub Security Advisory ID if the PR addresses a
   reported vulnerability.

PRs over ~600 lines of net change need to be split. Reviewer fatigue is
real and the engine handles real money — small focused diffs reduce risk.

PR review is by the maintainer (`@MarianneNems`). Expect comments within
72 hours for non-Critical changes. Critical security fixes are reviewed
the same day.

---

## Code style

- **TypeScript strict mode.** Don't loosen `tsconfig.json` to avoid
  fixing a type error.
- **No `any` in new code** unless the underlying library has no types
  and a one-line cast is genuinely the cleanest option. Add an inline
  comment explaining why.
- **Imports at the top of the file.** Never `require()` mid-function
  outside of the lazy-load pattern used in `server.ts:safeLoadRoute`.
- **Comments explain *why*, not *what*.** If the reasoning behind a
  decision isn't obvious from the code, write it down. If it is
  obvious, don't.
- **Error handling differs by layer.** Service classes throw with
  descriptive messages — don't swallow errors. Route handlers catch
  the service errors and surface `4xx` for user input issues and `5xx`
  for internal failures, always in `{success: false, error: "..."}`
  shape.
- **Two-space indentation, single quotes, semicolons.** Match the
  existing files.
- **No emojis** anywhere in source, comments, log messages, or commit
  messages.

---

## Testing

- **Unit tests** live in `tests/`. Run with `npm test`.
- **Integration tests** that hit the real Solana RPC or any paid API
  need an explicit `SKIP_LIVE_TESTS=0` env flag to run. Default is to
  skip them so CI doesn't burn quota.
- **Devnet first.** Any change to `src/services/nft-mint.service.ts`,
  `src/services/tola-nft-mint.service.ts`, or anything under
  `src/routes/mint*.ts` must be exercised end-to-end on Solana devnet
  before the PR is opened. Include the devnet transaction signature in
  the PR description.

If a test is failing because the underlying behavior is wrong, fix the
behavior — never fix the test to make it pass.

---

## Things you must not change without sign-off

These are contractual to the platform's economics and security. Any PR
that modifies them is auto-rejected unless the maintainer pre-approved
the change in writing:

| Constant / Pattern                            | Where                                              | Rule                                                                 |
| --------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| `IMMUTABLE_ROYALTY_BPS = 500`                 | `src/services/nft-mint.service.ts`                 | The 5% creator royalty is on-chain immutable. Never change.          |
| `SECONDARY_SALE_ROYALTY_BPS = 2000`           | `src/services/royalty.service.ts`                  | 20% total on-chain royalty (5% creator + 15% participants).          |
| `mintRateLimiter`, `mintGating` middleware    | `src/middleware/`                                  | Both are required on every `/mint*` route. Don't remove.             |
| `attachRequestId`, `buildSafeErrorResponse`   | `src/middleware/mint-error-handler.ts`             | Required for audit logging on mint paths.                            |
| `TreasuryMonitorService`                      | `src/services/treasury-monitor.service.ts`         | Health-check loop. Don't disable.                                    |
| Wallet env vars (`SYSTEM_CREATOR_ROYALTY_WALLET`, `TREASURY_PUBKEY`) | Multiple services | Renaming or aliasing without the maintainer's sign-off is rejected.  |

---

## Secrets and environment

- Real values live in Railway's environment-variable UI. Pull them down
  with `railway run printenv` (if you have CLI access) or ask the
  maintainer.
- `.env.example` in the repo lists every variable the engine reads.
  Keep it complete — when you add a new env var, add it to
  `.env.example` in the same commit.
- Never log secrets. The `logger` utility redacts known patterns
  (`sk-…`, `r8_…`, `rpa_…`) but don't rely on it; sanitize at the
  source.
- API keys without rotation endpoints are not adopted. If a service
  forces you to use an unrotatable key, raise it with the maintainer
  before integrating.

---

## Dependencies

- Production deps go in `dependencies`. Dev-only goes in
  `devDependencies`. Don't blur the line.
- Before adding a new dep, check whether `axios`, `express`, or the
  Solana / Metaplex packages already cover it.
- Lock the major version in `package.json` with a caret (`^x.y.z`). The
  `overrides` block at the top of `package.json` exists because some
  transitive deps had known issues — read the comments there before
  loosening anything.
- After `npm install`, commit `package-lock.json`. Never delete it.

---

## Logging

- Use the `logger` utility, not `console.log`. Production strips
  console output above `info`.
- Include enough context that a log line is self-describing: route,
  request id (from `attachRequestId`), and one or two domain ids
  (mint address, user id, transaction signature).
- Never log full request bodies on mint routes. Use the redacted shape
  emitted by `buildSafeErrorResponse`.

---

## Deploying

Railway watches `main`. When a PR merges, the deploy starts within
seconds. The build runs `npm install` then `npm run build`, then
`node dist/server.js`.

The `/health` endpoint exposes:

- `routes.loaded` / `routes.total` — number of route modules that
  loaded successfully. If `loaded < total`, a route failed `require()`
  at boot. Check the deploy log.
- `treasury.status` — `OK` if the treasury wallet has more than the
  configured minimum SOL balance.

After a deploy, hit `/health` and confirm both numbers look right
before declaring the release done.

---

## Getting help

Maintainer: Marianne Nems (`@MarianneNems`), `marianne@vortexartec.com`.

For security issues, follow `SECURITY.md` — do not open a public issue.
