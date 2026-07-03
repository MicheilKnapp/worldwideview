/**
 * Tier-based rate limit configuration for MCP plugin invocation endpoints.
 *
 * Maps user tiers to sliding-window request budgets (SEC-02, SEC-03).
 * Tier lookups are cached in-memory for 60s to avoid DB pressure.
 * On any error the limiter fails OPEN (returns free-tier config) so an
 * outage never blocks legit traffic.
 */

import { prisma } from "@/lib/db";

export interface McpRateLimitConfig {
    limit: number;
    windowMs: number;
}

const TIER_LIMITS: Record<string, McpRateLimitConfig> = {
    free: { limit: 60, windowMs: 60_000 },
    pro: { limit: 600, windowMs: 60_000 },
    enterprise: { limit: 6_000, windowMs: 60_000 },
};

const FREE_CONFIG: McpRateLimitConfig = { limit: 60, windowMs: 60_000 };

/**
 * Returns the rate limit config for a given tier.
 * Unknown tiers fall back to free.
 */
export function getRateLimitConfig(tier: string): McpRateLimitConfig {
    return TIER_LIMITS[tier] ?? FREE_CONFIG;
}

// ---------------------------------------------------------------------------
// In-memory tier cache with TTL (no DB hit per request)
// ---------------------------------------------------------------------------

interface TierCacheEntry {
    tier: string;
    expiresAt: number;
}

const tierCache = new Map<string, TierCacheEntry>();
const TIER_CACHE_TTL_MS = 60_000;

function getCachedTier(orgId: string): string | null {
    const entry = tierCache.get(orgId);
    if (!entry || Date.now() > entry.expiresAt) {
        tierCache.delete(orgId);
        return null;
    }
    return entry.tier;
}

function setCachedTier(orgId: string, tier: string): void {
    tierCache.set(orgId, { tier, expiresAt: Date.now() + TIER_CACHE_TTL_MS });
}

// Evict stale entries periodically
const CACHE_CLEANUP_INTERVAL_MS = 300_000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
function ensureCleanupTimer(): void {
    if (cleanupTimer) return;
    cleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of tierCache) {
            if (now > entry.expiresAt) tierCache.delete(key);
        }
    }, CACHE_CLEANUP_INTERVAL_MS);
    if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
        cleanupTimer.unref();
    }
}
ensureCleanupTimer();

/**
 * Resolves the effective MCP rate-limit tier for a given user + key combo.
 *
 * Resolution order:
 *   1. If the key has a tenantId, look up the OrgTier for that org.
 *   2. Fallback to the user's oldest PluginMember membership tier.
 *   3. Default: "free"
 *
 * Tier lookups are cached in-memory for 60 seconds. On Redis/DB error
 * returns "free" (fail open).
 */
export async function resolveMcpTier(
    userId: string,
    keyTenantId: string | null,
): Promise<string> {
    // Phase 1: direct org ID from key's tenant
    const orgId = keyTenantId;
    if (orgId) {
        const cached = getCachedTier(orgId);
        if (cached) return cached;

        try {
            const orgTier = await prisma.orgTier.findUnique({
                where: { organizationId: orgId },
                select: { tier: true },
            });
            const tier = orgTier?.tier ?? "free";
            setCachedTier(orgId, tier);
            return tier;
        } catch {
            return "free";
        }
    }

    // Phase 2: fallback to user's org membership
    try {
        const membership = await prisma.pluginMember.findFirst({
            where: { userId },
            select: { organizationId: true },
            orderBy: { createdAt: "asc" },
        });

        if (membership) {
            const cached = getCachedTier(membership.organizationId);
            if (cached) return cached;

            const orgTier = await prisma.orgTier.findUnique({
                where: { organizationId: membership.organizationId },
                select: { tier: true },
            });
            const tier = orgTier?.tier ?? "free";
            setCachedTier(membership.organizationId, tier);
            return tier;
        }
    } catch {
        // fall through to default
    }

    return "free";
}
