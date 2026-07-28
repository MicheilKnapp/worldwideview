import { NextResponse } from "next/server";

// Commercial aircraft tracking via OpenSky Network's public REST API. Served
// directly from our own domain so the aviation plugin's REST fallback (and,
// via the polling interval override, its ongoing updates) works without
// depending on the shared cloud data engine having a seeder running.
//
// Anonymous OpenSky access is capped at ~400 credits/day (a /states/all call
// costs 4 credits), so this server-side fetch cache is held for 15 minutes
// without credentials -- regardless of how often the client polls our own
// route, the actual upstream OpenSky call only happens once per window.
// With OPENSKY_CREDENTIALS set (much higher quota), cache for 60s instead.
const ANONYMOUS_REVALIDATE_SECONDS = 15 * 60;
const AUTHENTICATED_REVALIDATE_SECONDS = 60;

const OPENSKY_URL = "https://opensky-network.org/api/states/all";
// OpenSky exclusively supports the OAuth2 client_credentials flow -- plain
// HTTP Basic auth with client_id:client_secret is no longer accepted.
const OPENSKY_TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

interface OpenSkyAircraft {
    icao24: string;
    callsign: string | null;
    origin_country: string;
    ts: number | null;
    lon: number;
    lat: number;
    alt: number;
    on_ground: boolean;
    spd: number;
    hdg: number;
    vertical_rate: number | null;
    squawk: string | null;
}

// Access tokens are valid for 30 minutes; cache across requests within this
// server process so we don't re-authenticate on every poll.
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function getAccessToken(clientId: string, clientSecret: string): Promise<string | null> {
    if (cachedToken && cachedToken.expiresAt > Date.now()) {
        return cachedToken.accessToken;
    }

    try {
        const body = new URLSearchParams({
            grant_type: "client_credentials",
            client_id: clientId,
            client_secret: clientSecret,
        });
        const res = await fetch(OPENSKY_TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
        });
        if (!res.ok) {
            console.error(`[AviationRoute] OpenSky token exchange failed: ${res.status}`);
            return null;
        }
        const data = (await res.json()) as { access_token?: string; expires_in?: number };
        if (!data.access_token) return null;

        // Refresh 60s before actual expiry so we never use a token that
        // expires mid-request.
        const ttlMs = Math.max((data.expires_in ?? 1800) - 60, 60) * 1000;
        cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + ttlMs };
        return cachedToken.accessToken;
    } catch (err) {
        console.error("[AviationRoute] OpenSky token exchange error:", err);
        return null;
    }
}

export async function GET() {
    try {
        const credentialsRaw = process.env.OPENSKY_CREDENTIALS?.split(",")[0]?.trim();
        let accessToken: string | null = null;

        if (credentialsRaw) {
            const [clientId, clientSecret] = credentialsRaw.split(":");
            if (clientId && clientSecret) {
                accessToken = await getAccessToken(clientId, clientSecret);
            }
        }

        const headers: Record<string, string> = { Accept: "application/json", "User-Agent": "WorldWideView/1.0" };
        if (accessToken) {
            headers.Authorization = `Bearer ${accessToken}`;
        }

        const response = await fetch(OPENSKY_URL, {
            headers,
            next: { revalidate: accessToken ? AUTHENTICATED_REVALIDATE_SECONDS : ANONYMOUS_REVALIDATE_SECONDS },
        });

        if (!response.ok) {
            return NextResponse.json(
                { error: "Failed to fetch aviation data", status: response.status },
                { status: 502 },
            );
        }

        const data = (await response.json()) as { states?: unknown[][] | null };
        if (!Array.isArray(data.states)) {
            return NextResponse.json({ items: [] });
        }

        const items: OpenSkyAircraft[] = data.states
            .filter((s) => s[5] != null && s[6] != null)
            .map((s) => ({
                icao24: s[0] as string,
                callsign: (s[1] as string | null)?.trim() || null,
                origin_country: s[2] as string,
                ts: (s[3] as number | null) ?? (s[4] as number | null),
                lon: s[5] as number,
                lat: s[6] as number,
                alt: (s[7] as number | null) ?? 0,
                on_ground: s[8] as boolean,
                spd: (s[9] as number | null) ?? 0,
                hdg: (s[10] as number | null) ?? 0,
                vertical_rate: s[11] as number | null,
                squawk: s[14] as string | null,
            }));

        return NextResponse.json({ items });
    } catch (error) {
        console.error("[AviationRoute] Error:", error);
        return NextResponse.json(
            { error: "Failed to fetch aviation data" },
            { status: 502 },
        );
    }
}
