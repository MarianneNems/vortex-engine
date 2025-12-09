/**
 * TOLA Service - Dexscreener & Jupiter Integration
 */

import axios from 'axios';
import { logger } from '../utils/logger';

const TOLA_MINT = process.env.TOLA_MINT || 'H6qNYafSrpCjckH8yVwiPmXYPd1nCNBP8uQMZkv5hkky';
const DEXSCREENER_BASE = process.env.DEXSCREENER_BASE || 'https://api.dexscreener.com/latest/dex';
const JUP_API = process.env.JUP_API || 'https://quote-api.jup.ag/v6';

export interface TolaSnapshot {
    price: number;
    liquidity: number;
    volume24h: number;
    fdv: number;
    pairAddress: string;
    dexId: string;
    baseToken: {
        address: string;
        name: string;
        symbol: string;
    };
    quoteToken: {
        address: string;
        symbol: string;
    };
    priceChange24h: number;
    links: {
        dexscreener: string;
        raydium: string;
        solscan: string;
    };
}

export interface SwapQuote {
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    priceImpactPct: number;
    routePlan: any[];
    otherAmountThreshold: string;
    swapMode: string;
    slippageBps: number;
}

export class TolaService {
    
    /**
     * Get TOLA snapshot from Dexscreener
     */
    async getSnapshot(): Promise<TolaSnapshot> {
        try {
            // Search for TOLA pairs on Solana
            const response = await axios.get(`${DEXSCREENER_BASE}/tokens/${TOLA_MINT}`);
            
            if (!response.data || !response.data.pairs || response.data.pairs.length === 0) {
                throw new Error('No TOLA pairs found on Dexscreener');
            }
            
            // Get best pair (highest liquidity on Raydium)
            const pairs = response.data.pairs.filter((p: any) => 
                p.chainId === 'solana' && 
                (p.dexId === 'raydium' || p.dexId === 'orca')
            );
            
            if (pairs.length === 0) {
                throw new Error('No Raydium/Orca pairs found for TOLA');
            }
            
            // Sort by liquidity and take best one
            pairs.sort((a: any, b: any) => parseFloat(b.liquidity.usd) - parseFloat(a.liquidity.usd));
            const bestPair = pairs[0];
            
            const snapshot: TolaSnapshot = {
                price: parseFloat(bestPair.priceUsd),
                liquidity: parseFloat(bestPair.liquidity.usd),
                volume24h: parseFloat(bestPair.volume.h24),
                fdv: parseFloat(bestPair.fdv || 0),
                pairAddress: bestPair.pairAddress,
                dexId: bestPair.dexId,
                baseToken: {
                    address: bestPair.baseToken.address,
                    name: bestPair.baseToken.name,
                    symbol: bestPair.baseToken.symbol
                },
                quoteToken: {
                    address: bestPair.quoteToken.address,
                    symbol: bestPair.quoteToken.symbol
                },
                priceChange24h: parseFloat(bestPair.priceChange.h24),
                links: {
                    dexscreener: `https://dexscreener.com/solana/${bestPair.pairAddress}`,
                    raydium: `https://raydium.io/swap/?inputCurrency=sol&outputCurrency=${TOLA_MINT}`,
                    solscan: `https://solscan.io/token/${TOLA_MINT}`
                }
            };
            
            logger.info(`[TOLA] Snapshot: $${snapshot.price}, Liq: $${snapshot.liquidity}, Vol: $${snapshot.volume24h}`);
            
            return snapshot;
            
        } catch (error) {
            logger.error('[TOLA] Snapshot error:', error);
            throw error;
        }
    }
    
    /**
     * Get swap quote from Jupiter
     */
    async getQuote(params: {
        inputMint: string;
        outputMint: string;
        amount: number;
        slippageBps: number;
    }): Promise<SwapQuote> {
        try {
            const response = await axios.get(`${JUP_API}/quote`, {
                params: {
                    inputMint: params.inputMint,
                    outputMint: params.outputMint,
                    amount: params.amount,
                    slippageBps: params.slippageBps
                }
            });
            
            if (!response.data) {
                throw new Error('No quote received from Jupiter');
            }
            
            const quote = response.data;
            
            const swapQuote: SwapQuote = {
                inputMint: params.inputMint,
                outputMint: params.outputMint,
                inAmount: quote.inAmount,
                outAmount: quote.outAmount,
                priceImpactPct: parseFloat(quote.priceImpactPct || 0),
                routePlan: quote.routePlan || [],
                otherAmountThreshold: quote.otherAmountThreshold,
                swapMode: quote.swapMode,
                slippageBps: params.slippageBps
            };
            
            logger.info(`[TOLA] Quote: ${params.amount} -> ${quote.outAmount} (impact: ${swapQuote.priceImpactPct}%)`);
            
            return swapQuote;
            
        } catch (error) {
            logger.error('[TOLA] Quote error:', error);
            throw error;
        }
    }
    
    /**
     * Get TOLA price in USD
     */
    async getTolaPrice(): Promise<number> {
        try {
            const snapshot = await this.getSnapshot();
            return snapshot.price;
        } catch (error) {
            logger.error('[TOLA] Price fetch error:', error);
            return 1.0; // Fallback to $1
        }
    }
}

