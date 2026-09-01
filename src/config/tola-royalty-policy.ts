/**
 * CANONICAL TOLA MASTERPIECE ROYALTY POLICY (Founder-ratified 2026-09-01).
 *
 * Secondary-sale royalty on newly released TOLA Masterpiece paths:
 *
 *   total          = 2000 basis points (20% of gross)
 *   creator of VORTEX =  5% of gross  = 25% of the royalty pool
 *   participants      = 15% of gross  = 75% of the royalty pool, divided EQUALLY
 *                       among the verified participants of that exact work
 *
 * Frozen constants: no environment variable can override the rate or the equality.
 * Metaplex creator shares must total 100 and are NOT the gross percentages - the
 * pool split (25/75) is what the creator list encodes.
 *
 * The 65 previously certified works carry 500 bps on chain as historical fact; they
 * are updated only under a Founder-approved execution manifest, never implicitly.
 * The member (VORTEX ARTEC creator-lane) royalty remains 500 bps and is out of this
 * policy's scope.
 *
 * External marketplaces may not honor Metaplex royalty metadata; this module defines
 * the CONFIGURED royalty. VORTEX-controlled settlement must enforce the full
 * distribution itself.
 */

export const TOLA_SECONDARY_ROYALTY_BPS = 2000 as const;
export const CREATOR_POOL_SHARE = 25 as const;      // of the royalty pool
export const PARTICIPANT_POOL_SHARE = 75 as const;  // of the royalty pool
export const CREATOR_GROSS_PERCENT = 5 as const;    // of the gross sale
export const PARTICIPANT_GROSS_PERCENT = 15 as const;

/** Metaplex metadata supports at most five creator entries. */
export const METAPLEX_CREATOR_LIMIT = 5 as const;

// Tamper check, same posture as the historical 500-bps lock: if these drift the
// process refuses to start rather than minting a wrong royalty.
if (
    (TOLA_SECONDARY_ROYALTY_BPS as number) !== 2000
    || (CREATOR_POOL_SHARE as number) + (PARTICIPANT_POOL_SHARE as number) !== 100
    || (CREATOR_GROSS_PERCENT as number) + (PARTICIPANT_GROSS_PERCENT as number) !== 20
) {
    throw new Error('[TOLA ROYALTY POLICY] CRITICAL: canonical royalty constants tampered');
}

export type RoyaltyMode = 'direct' | 'vault';

/**
 * Direct mode is legal ONLY when equality is exactly representable in integer
 * Metaplex shares AND everyone fits inside the creator-entry limit. Otherwise the
 * work must use vault mode. No approximation is ever permitted: 75 must divide
 * evenly, because an unequal split would silently weight participants.
 */
export function directModeAllowed(participantCount: number): boolean {
    if (!Number.isInteger(participantCount) || participantCount < 1) { return false; }
    if (1 + participantCount > METAPLEX_CREATOR_LIMIT) { return false; }
    return PARTICIPANT_POOL_SHARE % participantCount === 0;
}

export function royaltyMode(participantCount: number): RoyaltyMode {
    return directModeAllowed(participantCount) ? 'direct' : 'vault';
}

/** Each participant's entitlement, as a fraction of the GROSS sale (15% / N). */
export function participantGrossEntitlement(participantCount: number): number {
    if (!Number.isInteger(participantCount) || participantCount < 1) {
        throw new Error('participant count must be a positive integer');
    }
    return PARTICIPANT_GROSS_PERCENT / participantCount;
}

export interface CreatorEntry {
    address: string;
    share: number;      // integer, all entries total exactly 100
    verified: boolean;  // truthfulness is the caller's duty: true only for actual signers
}

/**
 * Direct-mode creator list: [creator 25, each participant 75/N]. Refuses when
 * direct mode is not exactly representable - callers must fall back to vault mode
 * rather than shave shares.
 */
export function buildDirectCreatorList(
    creatorOfVortexWallet: string,
    participantWallets: string[],
): CreatorEntry[] {
    const n = participantWallets.length;
    if (!directModeAllowed(n)) {
        throw new Error(`direct mode not representable for ${n} participants - use vault mode`);
    }
    if (new Set([creatorOfVortexWallet, ...participantWallets]).size !== n + 1) {
        throw new Error('creator and participant wallets must be distinct');
    }
    const each = PARTICIPANT_POOL_SHARE / n;
    const list: CreatorEntry[] = [
        { address: creatorOfVortexWallet, share: CREATOR_POOL_SHARE, verified: false },
        ...participantWallets.map((w) => ({ address: w, share: each, verified: false })),
    ];
    const total = list.reduce((s, c) => s + c.share, 0);
    if (total !== 100) { throw new Error(`creator shares total ${total}, must be 100`); }
    return list;
}

/** Vault-mode pool split: [creator 25, participant vault 75]. */
export function buildVaultCreatorList(
    creatorOfVortexWallet: string,
    participantVaultAddress: string,
): CreatorEntry[] {
    if (creatorOfVortexWallet === participantVaultAddress) {
        throw new Error('the participant vault must be distinct from the creator wallet');
    }
    return [
        { address: creatorOfVortexWallet, share: CREATOR_POOL_SHARE, verified: false },
        { address: participantVaultAddress, share: PARTICIPANT_POOL_SHARE, verified: false },
    ];
}

/**
 * Settlement-unit split of a received participant-pool amount (e.g. USDC micro-units)
 * across N participants: equal integer shares, remainder CARRIED - never paid to the
 * creator, never absorbed. The carry equalizes on later distributions.
 */
export function splitPoolAmount(
    amountUnits: bigint,
    participantCount: number,
): { each: bigint; carry: bigint } {
    if (!Number.isInteger(participantCount) || participantCount < 1) {
        throw new Error('participant count must be a positive integer');
    }
    const n = BigInt(participantCount);
    return { each: amountUnits / n, carry: amountUnits % n };
}
