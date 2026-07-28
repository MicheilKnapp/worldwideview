import { NextResponse } from "next/server";

// Mirrors local-seeders/community/packages/aviation's logic: commercial
// aircraft tracking via OpenSky Network's public REST API. Served directly
// from our own domain so the aviation plugin's REST fallback (and, via the
// polling interval override, its ongoing updates) works without depending
// on the shared cloud data engine having a seeder running.
export const revalidate = 60;

const OPENSKY_URL = "https://opensky-network.org/api/states/all";

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

export async function GET() {
    try {
        const credentials = process.env.OPENSKY_CREDENTIALS?.split(",")[0]?.trim();
        const headers: Record<string, string> = { Accept: "application/json", "User-Agent": "WorldWideView/1.0" };
        if (credentials) {
            headers.Authorization = `Basic ${Buffer.from(credentials).toString("base64")}`;
        }

        const response = await fetch(OPENSKY_URL, {
            headers,
            next: { revalidate },
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
