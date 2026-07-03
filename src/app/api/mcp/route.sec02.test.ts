/**
 * SEC-02: Redis per-key rate limiting in /api/mcp route tests.
 *
 * Verifies the post-auth Redis sliding-window gate behavior.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Top-level mocks (same surface as route.test.ts)
// ---------------------------------------------------------------------------

vi.mock("@/lib/apiKeyAuth", () => ({
    authenticateApiKey: vi.fn(),
}));

vi.mock("@/core/edition", () => ({
    isDemo: false,
    edition: "local",
    isLocal: true,
    isCloud: false,
}));

vi.mock("@/lib/geocodingRateLimit", () => ({
    redisSlidingWindow: vi.fn(),
}));

vi.mock("@/lib/mcpRateLimit", () => ({
    resolveMcpTier: async () => "free",
    getRateLimitConfig: () => ({ limit: 120, windowMs: 60_000 }),
}));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => {
    const McpServer = vi.fn(function McpServerMock(this: unknown) {
        return {
            connect: vi.fn().mockResolvedValue(undefined),
            registerResource: vi.fn(),
            registerTool: vi.fn(),
            registerPrompt: vi.fn(),
        };
    });
    const ResourceTemplate = vi.fn(function ResourceTemplateMock(this: unknown, uriTemplate: string) {
        return { uriTemplate };
    });
    return { McpServer, ResourceTemplate };
});

vi.mock("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js", () => {
    const WebStandardStreamableHTTPServerTransport = vi.fn().mockImplementation(() => ({
        handleRequest: vi.fn().mockResolvedValue(
            new Response(null, {
                status: 200,
                headers: {
                    "X-Accel-Buffering": "no",
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache, no-transform",
                    Connection: "keep-alive",
                },
            })
        ),
    }));
    return { WebStandardStreamableHTTPServerTransport };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { POST } from "./route";
import { authenticateApiKey } from "@/lib/apiKeyAuth";
import { redisSlidingWindow } from "@/lib/geocodingRateLimit";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePost(authorization?: string): Request {
    const headers: Record<string, string> = {};
    if (authorization) headers["authorization"] = authorization;
    return new Request("http://localhost:3000/api/mcp", { method: "POST", headers });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SEC-02: per-key Redis rate limit gate", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(authenticateApiKey).mockResolvedValue({ userId: "u1", keyId: "k1" });
    });

    it("passes through when Redis allows the request", async () => {
        vi.mocked(redisSlidingWindow).mockResolvedValue({ allowed: true, retryAfterMs: 0 });

        const res = await POST(makePost("Bearer wwv_valid.token"));
        expect(res.status).not.toBe(429);
    });

    it("returns 429 JSON-RPC -32000 when Redis rejects the request", async () => {
        vi.mocked(redisSlidingWindow).mockResolvedValue({ allowed: false, retryAfterMs: 60_000 });

        const res = await POST(makePost("Bearer wwv_valid.token"));
        const body = await res.json();

        expect(res.status).toBe(429);
        expect(body).toMatchObject({
            jsonrpc: "2.0",
            error: { code: -32000, message: "rate limit exceeded" },
            id: null,
        });
        expect(res.headers.get("Retry-After")).toBe("60");
    });

    it("rate limit check uses the authenticated keyId, not userId or raw header", async () => {
        vi.mocked(authenticateApiKey).mockResolvedValue({ userId: "user-abc", keyId: "key-xyz" });
        vi.mocked(redisSlidingWindow).mockResolvedValue({ allowed: true, retryAfterMs: 0 });

        await POST(makePost("Bearer wwv_valid.token"));

        expect(vi.mocked(redisSlidingWindow)).toHaveBeenCalledWith(
            expect.stringContaining("key-xyz"),
            expect.any(Number),
            expect.any(Number),
        );
    });

    it("rate limit is not checked when auth fails (no authenticated keyId available)", async () => {
        vi.mocked(authenticateApiKey).mockResolvedValue(null);

        const res = await POST(makePost("Bearer bogus.token"));

        expect(res.status).toBe(401);
        expect(vi.mocked(redisSlidingWindow)).not.toHaveBeenCalled();
    });
});
