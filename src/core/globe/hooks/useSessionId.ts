import { useRef, useState, useEffect } from "react";

const SESSION_ID_KEY = "wwv-globe-session-id";

// crypto.randomUUID() only exists in secure contexts (HTTPS, or the
// localhost exception) -- plain http://<lan-ip> or http://<tailscale-ip>
// access has no such method and throws. crypto.getRandomValues() has no
// such restriction, so build a UUID v4 from it instead.
function generateSessionId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function useSessionId(): string {
    // resolvedRef caches the id after the first effect run so rerenders are free
    const resolvedRef = useRef<string>("");
    const [sessionId, setSessionId] = useState<string>("");

    useEffect(() => {
        if (resolvedRef.current) return;

        // sessionStorage is only available in the browser (this effect never runs on the server)
        const existing = sessionStorage.getItem(SESSION_ID_KEY);
        const id = existing ?? (() => {
            const newId = generateSessionId();
            sessionStorage.setItem(SESSION_ID_KEY, newId);
            return newId;
        })();

        resolvedRef.current = id;
        setSessionId(id);
    }, []);

    return sessionId;
}
