# Security Policy — vortex-engine

This repository is the production backend for the VORTEX ARTEC marketplace
(vortexartec.com) — custodial Solana blockchain logic, USDC payment rails,
NFT minting via Metaplex, royalty distribution, and AI agent orchestration
deployed on Railway. Security here directly affects real funds and live
on-chain transactions, so all findings are treated as material.

This is a **private repository**. Access is by invitation only. If you
have access, you have an obligation to follow the disclosure process below
when you find anything that could be exploited.

---

## Supported Versions

Only the `main` branch is supported. Patches land directly on `main` and
are deployed automatically to Railway. There are no LTS releases.

| Branch       | Status            |
| ------------ | ----------------- |
| `main`       | Supported         |
| Anything else | Not supported    |

---

## What's In-Scope

Anything that could lead to:

- Loss, theft, or unauthorized transfer of funds (USDC, SOL, TOLA tokens)
- Unauthorized NFT minting, transfer, or royalty redirection
- Bypass of the immutable royalty configuration (5% creator + 15% participants)
- Server-side request forgery against Solana RPC, Anthropic, OpenAI, RunPod,
  Replicate, or Stripe endpoints reached from the engine
- Authentication bypass on any `/api/*` route, particularly the mint
  endpoints, the storyboard pipeline, and the WP-compat handlers under
  `/api/tola/*` and `/wp/*`
- Webhook spoofing (HMAC bypass, replay attacks, signature confusion)
- Treasury wallet exposure (private key leakage, mnemonic disclosure,
  cleartext storage in logs / env / responses)
- Privilege escalation against the Railway environment, GitHub deploy
  workflow, or any service connected via API key
- Denial-of-service vectors that can deplete paid third-party quotas
  (Anthropic, OpenAI, RunPod, Stripe) at attacker-controlled cost

## Out-of-Scope

- Dependency vulnerabilities flagged by Dependabot — those have a separate
  triage track. Don't re-report them here.
- Vulnerabilities in unmodified third-party libraries that we already track
  via npm audit.
- Anything requiring physical access to a developer machine.
- Self-XSS and social-engineering scenarios.
- Findings in `dist/` files — fix the corresponding `src/` and the
  compiled output is regenerated.

---

## How to Report

**Do not open a public issue or pull request.** Use one of:

1. **Email:** `marianne@vortexartec.com` — PGP key on request.
2. **GitHub Security Advisory** (preferred for collaborators with repo
   access): `Security` tab → `Report a vulnerability`. Private to the
   maintainer team until disclosure is coordinated.

Include:

- A short summary (one sentence) of the vulnerability class.
- Steps to reproduce — exact request payloads, transaction hashes,
  wallet addresses if relevant.
- The route, file, and line you traced the issue to in `src/`.
- An assessment of the realistic impact (funds at risk, attacker
  prerequisites, whether mainnet or devnet).
- Optional: a suggested patch.

Reports that are unactionable (no repro, no file references, AI-generated
boilerplate) will be closed without response.

---

## Response Targets

| Severity | Acknowledge | Fix in `main`     |
| -------- | ----------- | ----------------- |
| Critical | 24 h        | 72 h              |
| High     | 72 h        | 7 days            |
| Moderate | 7 days      | 30 days           |
| Low      | 14 days     | Next release cycle |

**Critical** = active loss of funds, full takeover of mint authority,
unauthenticated access to treasury wallet operations.

**High** = bypass of authentication on a non-treasury route, royalty
redirection, AI cost-exhaustion vector with no auth requirement.

**Moderate** = signature spoofing requiring a stolen key, info disclosure
in logs, SSRF against a non-paid third-party endpoint.

**Low** = log noise, theoretical issues with no realistic exploit path.

---

## Disclosure Coordination

The maintainer will coordinate disclosure with the reporter. Default
posture is:

1. Patch lands on `main` and deploys to Railway.
2. Reporter confirms the fix in the production environment.
3. Public advisory published 30 days after the patch ships — earlier if
   coordinated, later only if the patch needs operational changes that
   take longer.

Reporters who follow this process in good faith will be credited in the
advisory unless they request otherwise.

---

## Safe Harbor

Good-faith security research against `vortex-engine-production.up.railway.app`
and `vortexartec.com` is welcome, provided:

- You do not move funds you do not own.
- You do not exfiltrate data belonging to other users.
- You do not run sustained traffic that would cost the platform money
  (paid-API DoS) — a single proof-of-concept request is fine; a sustained
  attack is not.
- You report promptly via the channels above.

We will not pursue legal action against researchers who stay within those
boundaries. We will pursue action against anyone outside them.

---

## Rewards

This is a private commercial repository. There is no public bug bounty.
Material findings (Critical or High) reported by external researchers will
be considered for an ex-gratia reward at the maintainer's discretion;
amounts and form (USDC, NFT, public credit) are decided per case.

---

## Operational Security Practices

For contributors with commit access:

- Never commit `.env`, wallet keys, mnemonics, or API credentials. Use
  Railway's environment-variable UI for all secrets.
- Pre-commit hook (recommended local install): `npx git-secrets --install`
  and scan staged files before push.
- All third-party API keys must be revocable. If a key has no rotation
  endpoint, do not adopt the service.
- Treasury wallet operations are gated by `middleware/mint-gating.middleware`
  and `middleware/mint-rate-limit.middleware`. Both are required for any
  mint route. Removing or weakening them is a Critical change and requires
  the maintainer's explicit sign-off in writing.
- Dependency upgrades that touch `@solana/*`, `@metaplex-foundation/*`,
  `axios`, or `express` require a manual test on devnet before merge to
  `main`.
- The immutable royalty configuration (`IMMUTABLE_ROYALTY_BPS = 500` +
  `SECONDARY_SALE_ROYALTY_BPS = 2000`) is contractual. Any PR that changes
  those values is rejected without review.

---

Maintainer: Marianne Nems (`@MarianneNems`)
Last reviewed: 2026-05-18
