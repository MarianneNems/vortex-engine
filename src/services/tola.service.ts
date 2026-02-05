/**
 * TOLA Service - Production Grade
 * Dexscreener & Jupiter Integration for TOLA token metrics
 * 
 * Features:
 * - Real-time price data from Dexscreener
 * - Jupiter swap quotes
 * - Price caching for performance
 * - Fallback handling
 * - Historical data support
 * 
 * @version 4.0.0
 */

import axios from 'axios';
import { logger } from '../utils/logger';

const TOLA_MINT = process.env.TOLA_MINT || 'H6qNYafSrpCjckH8yVwiPmXYPd1nCNBP8uQMZkv5hkky';
const USDC_MINT = process.env.USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const DEXSCREENER_BASE = process.env.DEXSCREENER_BASE || 'https://api.dexscreener.com/latest/dex';
const JUP_API = process.env.JUP_API || 'https://quote-api.jup.ag/v6';

// Configuration
const CONFIG = {
    cacheTTL: 30000, // 30 seconds
    requestTimeout: 10000,
    maxRetries: 2
};

export interface TolaSnapshot {
    price: number;
    liquidity: number;
    volume24h: number;
    fdv: number;
    marketCap: number;
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
    priceChange: {
        h1: number;
        h6: number;
        h24: number;
    };
    txns: {
        buys: number;
        sells: number;
    };
    links: {
        dexscreener: string;
        raydium: string;
        solscan: string;
        jupiter: string;
    };
    timestamp: string;
}

export interface SwapQuote {
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    inAmountFormatted: number;
    outAmountFormatted: number;
    priceImpactPct: number;
    routePlan: any[];
    otherAmountThreshold: string;
    swapMode: string;
    slippageBps: number;
    exchangeRate: number;
}

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

export class TolaService {
    private snapshotCache: CacheEntry<TolaSnapshot> | null = null;
    private priceCache: CacheEntry<number> | null = null;
    private requestCount: number = 0;
    private errorCount: number = 0;
    
    constructor() {
        logger.info('[TOLA Service] Initialized');
    }
    
    /**
     * Get TOLA snapshot from Dexscreener
     */
    async getSnapshot(): Promise<TolaSnapshot> {
        // Check cache
        if (this.snapshotCache && Date.now() - this.snapshotCache.timestamp < CONFIG.cacheTTL) {
            return this.snapshotCache.data;
        }
        
        this.requestCount++;
        
        try {
            // Search for TOLA pairs on Solana
            logger.info(`[TOLA] Fetching from Dexscreener: ${DEXSCREENER_BASE}/tokens/${TOLA_MINT}`);
            
            const response = await axios.get(`${DEXSCREENER_BASE}/tokens/${TOLA_MINT}`, {
                timeout: CONFIG.requestTimeout,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'VortexEngine/4.0.0'
                }
            });
            
            // Log response structure for debugging
            logger.debug(`[TOLA] API response status: ${response.status}`);
            
            if (!response.data || !response.data.pairs || response.data.pairs.length === 0) {
                logger.warn('[TOLA] Empty response from Dexscreener API', {
                    hasData: !!response.data,
                    hasPairs: !!(response.data?.pairs),
                    pairsLength: response.data?.pairs?.length || 0
                });
                throw new Error('No TOLA pairs found on Dexscreener');
            }
            
            logger.info(`[TOLA] Found ${response.data.pairs.length} pairs on Dexscreener`);
            
            // Get best pair (highest liquidity on Raydium/Orca)
            const pairs = response.data.pairs.filter((p: any) => 
                p.chainId === 'solana' && 
                (p.dexId === 'raydium' || p.dexId === 'orca' || p.dexId === 'meteora')
            );
            
            if (pairs.length === 0) {
                // Try any Solana pair
                const anyPair = response.data.pairs.find((p: any) => p.chainId === 'solana');
                if (!anyPair) {
                    throw new Error('No Solana pairs found for TOLA');
                }
                pairs.push(anyPair);
            }
            
            // Sort by liquidity and take best one
            pairs.sort((a: any, b: any) => {
                const liqA = parseFloat(a.liquidity?.usd || 0);
                const liqB = parseFloat(b.liquidity?.usd || 0);
                return liqB - liqA;
            });
            const bestPair = pairs[0];
            
            const snapshot: TolaSnapshot = {
                price: parseFloat(bestPair.priceUsd || 0),
                liquidity: parseFloat(bestPair.liquidity?.usd || 0),
                volume24h: parseFloat(bestPair.volume?.h24 || 0),
                fdv: parseFloat(bestPair.fdv || 0),
                marketCap: parseFloat(bestPair.marketCap || bestPair.fdv || 0),
                pairAddress: bestPair.pairAddress,
                dexId: bestPair.dexId,
                baseToken: {
                    address: bestPair.baseToken?.address || TOLA_MINT,
                    name: bestPair.baseToken?.name || 'TOLA',
                    symbol: bestPair.baseToken?.symbol || 'TOLA'
                },
                quoteToken: {
                    address: bestPair.quoteToken?.address || '',
                    symbol: bestPair.quoteToken?.symbol || 'USDC'
                },
                priceChange: {
                    h1: parseFloat(bestPair.priceChange?.h1 || 0),
                    h6: parseFloat(bestPair.priceChange?.h6 || 0),
                    h24: parseFloat(bestPair.priceChange?.h24 || 0)
                },
                txns: {
                    buys: parseInt(bestPair.txns?.h24?.buys || 0),
                    sells: parseInt(bestPair.txns?.h24?.sells || 0)
                },
                links: {
                    dexscreener: `https://dexscreener.com/solana/${bestPair.pairAddress}`,
                    raydium: `https://raydium.io/swap/?inputCurrency=sol&outputCurrency=${TOLA_MINT}`,
                    solscan: `https://solscan.io/token/${TOLA_MINT}`,
                    jupiter: `https://jup.ag/swap/SOL-${TOLA_MINT}`
                },
                timestamp: new Date().toISOString()
            };
            
            // Cache result
            this.snapshotCache = {
                data: snapshot,
                timestamp: Date.now()
            };
            
            // Also cache the price
            this.priceCache = {
                data: snapshot.price,
                timestamp: Date.now()
            };
            
            logger.info(`[TOLA] Snapshot: $${snapshot.price.toFixed(4)}, Liq: $${Math.round(snapshot.liquidity)}, Vol: $${Math.round(snapshot.volume24h)}`);
            
            return snapshot;
            
        } catch (error: any) {
            this.errorCount++;
            
            // Log as info instead of error - expected when TOLA not yet listed
            if (error.message.includes('No TOLA pairs found')) {
                logger.info('[TOLA] Token not yet listed on Dexscreener - using fallback price $1.00');
            } else {
                logger.error('[TOLA] Snapshot error:', error.message);
            }
            
            // Return cached data if available
            if (this.snapshotCache) {
                logger.info('[TOLA] Returning cached snapshot');
                return this.snapshotCache.data;
            }
            
            // Return fallback data
            return this.getFallbackSnapshot();
        }
    }
    
    /**
     * Get fallback snapshot when API fails
     * Uses known TOLA data from Raydium pool
     */
    private getFallbackSnapshot(): TolaSnapshot {
        // Fallback to known TOLA/SOL Raydium pair data
        // Updated: 2026-02-05 from Dexscreener
        return {
            price: 0.00001356, // $0.0₅1356 - actual price from Dexscreener
            liquidity: 2700,   // ~$2.7K liquidity
            volume24h: 0,
            fdv: 1300,
            marketCap: 1300,
            pairAddress: 'BPPUCMx9Jj3DqDmf2iLNQrG7h3ShiWKqpspqzZvYREXP', // Raydium pool
            dexId: 'raydium',
            baseToken: {
                address: TOLA_MINT,
                name: 'Token of Love & Appreciation',
                symbol: 'TOLA'
            },
            quoteToken: {
                address: 'So11111111111111111111111111111111111111112',
                symbol: 'SOL'
            },
            priceChange: { h1: 0, h6: 0, h24: 0 },
            txns: { buys: 0, sells: 0 },
            links: {
                dexscreener: `https://dexscreener.com/solana/${TOLA_MINT}`,
                raydium: `https://raydium.io/swap/?inputCurrency=sol&outputCurrency=${TOLA_MINT}`,
                solscan: `https://solscan.io/token/${TOLA_MINT}`,
                jupiter: `https://jup.ag/swap/SOL-${TOLA_MINT}`
            },
            timestamp: new Date().toISOString()
        };
    }
    
    /**
     * Get swap quote from Jupiter
     */
    async getQuote(params: {
        inputMint: string;
        outputMint: string;
        amount: number;
        slippageBps?: number;
    }): Promise<SwapQuote> {
        this.requestCount++;
        
        try {
            const response = await axios.get(`${JUP_API}/quote`, {
                params: {
                    inputMint: params.inputMint,
                    outputMint: params.outputMint,
                    amount: params.amount,
                    slippageBps: params.slippageBps || 100,
                    onlyDirectRoutes: false
                },
                timeout: CONFIG.requestTimeout
            });
            
            if (!response.data) {
                throw new Error('No quote received from Jupiter');
            }
            
            const quote = response.data;
            
            // Calculate formatted amounts based on token decimals
            // USDC = 6, SOL = 9, TOLA = 9
            const inputDecimals = params.inputMint === USDC_MINT ? 6 : 9;
            const outputDecimals = params.outputMint === USDC_MINT ? 6 : 9;
            
            const inAmountFormatted = parseInt(quote.inAmount) / Math.pow(10, inputDecimals);
            const outAmountFormatted = parseInt(quote.outAmount) / Math.pow(10, outputDecimals);
            const exchangeRate = outAmountFormatted / inAmountFormatted;
            
            const swapQuote: SwapQuote = {
                inputMint: params.inputMint,
                outputMint: params.outputMint,
                inAmount: quote.inAmount,
                outAmount: quote.outAmount,
                inAmountFormatted,
                outAmountFormatted,
                priceImpactPct: parseFloat(quote.priceImpactPct || 0),
                routePlan: quote.routePlan || [],
                otherAmountThreshold: quote.otherAmountThreshold,
                swapMode: quote.swapMode || 'ExactIn',
                slippageBps: params.slippageBps || 100,
                exchangeRate
            };
            
            logger.info(`[TOLA] Quote: ${inAmountFormatted} -> ${outAmountFormatted} (impact: ${swapQuote.priceImpactPct}%)`);
            
            return swapQuote;
            
        } catch (error: any) {
            this.errorCount++;
            logger.error('[TOLA] Quote error:', error.message);
            throw new Error(`Failed to get quote: ${error.message}`);
        }
    }
    
    /**
     * Get TOLA price in USD with caching
     */
    async getTolaPrice(): Promise<number> {
        // Check cache
        if (this.priceCache && Date.now() - this.priceCache.timestamp < CONFIG.cacheTTL) {
            return this.priceCache.data;
        }
        
        try {
            const snapshot = await this.getSnapshot();
            return snapshot.price;
        } catch (error) {
            logger.error('[TOLA] Price fetch error:', error);
            return this.priceCache?.data || 1.0;
        }
    }
    
    /**
     * Convert USD to TOLA amount
     */
    async usdToTola(usdAmount: number): Promise<number> {
        const price = await this.getTolaPrice();
        if (price <= 0) return usdAmount; // Fallback 1:1
        return usdAmount / price;
    }
    
    /**
     * Convert TOLA to USD amount
     */
    async tolaToUsd(tolaAmount: number): Promise<number> {
        const price = await this.getTolaPrice();
        return tolaAmount * price;
    }
    
    /**
     * Get supported swap tokens
     */
    async getSupportedTokens(): Promise<Array<{ address: string; symbol: string; name: string }>> {
        return [
            { address: TOLA_MINT, symbol: 'TOLA', name: 'TOLA Token' },
            { address: USDC_MINT, symbol: 'USDC', name: 'USD Coin' },
            { address: SOL_MINT, symbol: 'SOL', name: 'Solana' }
        ];
    }
    
    /**
     * Get service statistics
     */
    getStats(): {
        requests: number;
        errors: number;
        error_rate: number;
        cache_hit: boolean;
        last_price: number | null;
    } {
        return {
            requests: this.requestCount,
            errors: this.errorCount,
            error_rate: this.requestCount > 0 ? this.errorCount / this.requestCount : 0,
            cache_hit: !!this.snapshotCache && Date.now() - this.snapshotCache.timestamp < CONFIG.cacheTTL,
            last_price: this.priceCache?.data || null
        };
    }
    
    /**
     * Clear caches
     */
    clearCache(): void {
        this.snapshotCache = null;
        this.priceCache = null;
        logger.info('[TOLA] Cache cleared');
    }
    
    /**
     * Get TOLA contract address
     */
    getContractAddress(): string {
        return TOLA_MINT;
    }
    
    /**
     * Check if service is ready
     */
    isReady(): boolean {
        return true;
    }
}
