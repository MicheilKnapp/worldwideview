/**
 * Human-readable reasons a location request can fail.
 *
 * Kept separate from the button so the wording is testable without a DOM, and
 * so each failure says something actionable. "Location unavailable" tells the
 * user nothing about whether to retry, check a setting, or give up.
 */

/** Matches the browser's GeolocationPositionError codes. */
export const GEO_PERMISSION_DENIED = 1;
export const GEO_POSITION_UNAVAILABLE = 2;
export const GEO_TIMEOUT = 3;

export function geolocationErrorMessage(code: number | undefined): string {
    switch (code) {
        case GEO_PERMISSION_DENIED:
            return "Location permission denied. Allow location access for this site in your browser settings, then try again.";
        case GEO_POSITION_UNAVAILABLE:
            return "Your device could not determine a location. This often means no GPS fix and no network positioning.";
        case GEO_TIMEOUT:
            return "Locating timed out. Try again, ideally somewhere with a clearer view of the sky.";
        default:
            return "Could not get your location.";
    }
}

/**
 * Why the feature is unavailable before a request is even attempted, or null
 * when it can be attempted.
 *
 * Browsers only expose geolocation in a secure context, so on plain HTTP the
 * API is either missing or rejects — worth saying plainly rather than letting
 * it look like a denied permission.
 */
export function geolocationUnavailableReason(
    nav: { geolocation?: unknown } | undefined,
    isSecureContext: boolean | undefined,
): string | null {
    if (!nav?.geolocation) return "This browser does not support location.";
    if (isSecureContext === false) {
        return "Location requires a secure (HTTPS) connection.";
    }
    return null;
}
