"use client";

import { useState } from "react";
import { LocateFixed, Loader2 } from "lucide-react";

import { dataBus } from "@/core/data/DataBus";
import { useStore } from "@/core/state/store";
import { trackEvent } from "@/lib/analytics";
import {
    geolocationErrorMessage,
    geolocationUnavailableReason,
} from "@/core/hooks/geolocationErrors";

/** Give up rather than leave the user watching a spinner indefinitely. */
const TIMEOUT_MS = 10_000;
/** A cached fix up to a minute old is fine for centring a map. */
const MAX_AGE_MS = 60_000;

/**
 * Centres the globe on the visitor's own position, keeping the current zoom.
 *
 * Coordinates are used to move the camera and nothing else: they are not sent
 * anywhere, stored, or logged, which is worth preserving given the Privacy
 * Policy states no location data is collected.
 */
export function LocateMeButton() {
    const [busy, setBusy] = useState(false);
    const showErrorToast = useStore((s) => s.showErrorToast);

    const locate = () => {
        if (busy) return;

        const nav = typeof navigator === "undefined" ? undefined : navigator;
        const unavailable = geolocationUnavailableReason(
            nav,
            typeof window === "undefined" ? undefined : window.isSecureContext,
        );
        if (unavailable) {
            showErrorToast?.(unavailable);
            return;
        }

        setBusy(true);
        trackEvent("locate-me");

        nav!.geolocation.getCurrentPosition(
            (pos) => {
                setBusy(false);
                dataBus.emit("cameraCenterOn", {
                    lat: pos.coords.latitude,
                    lon: pos.coords.longitude,
                });
            },
            (err) => {
                setBusy(false);
                showErrorToast?.(geolocationErrorMessage(err?.code));
            },
            {
                enableHighAccuracy: false,
                timeout: TIMEOUT_MS,
                maximumAge: MAX_AGE_MS,
            },
        );
    };

    return (
        // Styled to match the sibling theme button in header__actions rather
        // than introducing a new class for a single control.
        <button
            type="button"
            className="btn btn--glow"
            style={{
                display: "flex",
                alignItems: "center",
                padding: "6px",
                background: "transparent",
                border: "none",
                cursor: busy ? "default" : "pointer",
                opacity: busy ? 0.6 : 1,
            }}
            onClick={locate}
            disabled={busy}
            title="Centre the map on my location"
            aria-label="Centre the map on my location"
            aria-busy={busy}
        >
            {busy
                ? <Loader2 size={18} className="locate-me__spinner" />
                : <LocateFixed size={18} />}
        </button>
    );
}
