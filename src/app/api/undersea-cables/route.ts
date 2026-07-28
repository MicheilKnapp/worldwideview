import { NextResponse } from "next/server";

// The undersea-cables plugin bundle fetches this exact same-origin path
// expecting a GeoJSON FeatureCollection (loaded directly into Cesium's
// GeoJsonDataSource). It was never implemented, so the plugin's own
// try/catch silently swallowed a 404 with no visible error -- just no
// cable data ever appeared.
//
// Proxies TeleGeography's public submarine cable map data (no CORS
// headers on their end, so this can't be fetched directly from the
// browser). The dataset changes rarely, so cache for 6 hours.
export const revalidate = 21600; // 6 hours

const CABLE_GEOJSON_URL = "https://www.submarinecablemap.com/api/v3/cable/cable-geo.json";

export async function GET() {
    try {
        const response = await fetch(CABLE_GEOJSON_URL, {
            headers: { Accept: "application/json", "User-Agent": "WorldWideView/1.0" },
            next: { revalidate },
        });

        if (!response.ok) {
            return NextResponse.json(
                { error: "Failed to fetch undersea cable data", status: response.status },
                { status: 502 },
            );
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error("[UnderseaCablesRoute] Error:", error);
        return NextResponse.json(
            { error: "Failed to fetch undersea cable data" },
            { status: 502 },
        );
    }
}
