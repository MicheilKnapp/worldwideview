import { timingSafeEqual } from "crypto";

import { NextResponse } from "next/server";

import { KEY_PREFIX } from "@/lib/surveillance/regions";
import { isSweepRunning, runSweep } from "@/lib/surveillance/sweep";

/**
 * Refreshes the surveillance-infrastructure cache from Overpass.
 *
 *   POST (with the sweep token) -> starts a sweep, returns 202 immediately
 *   GET                         -> whether one is currently running
 *
 * A full sweep takes minutes, so the POST does not wait for it: an HTTP client
 * (cron's curl) would time out long before it finished. Progress is observable
 * through GET and through the `fetchedAt` on the read route.
 *
 * NOTE: the app now sweeps on its own schedule (see
 * `lib/surveillance/scheduler.ts`), so this route is an OPTIONAL manual
 * override for forcing a refresh. It is NOT in `PUBLIC_API_PREFIXES`, so it
 * also needs a session cookie to reach — call it from a logged-in browser or
 * allowlist the path if you want to drive it from cron.
 *
 * This exists because the data engine is optional — an instance can run with
 * `engine: false` and still have Redis, leaving a seeder with nowhere to
 * execute. Instances that DO run the engine should use the seeder package
 * instead and leave this route untriggered; both write the same keys.
 *
 * Drive it from cron on the host every six hours. The crontab line is in the
 * README rather than here: a cron expression contains a slash-star sequence,
 * which would close this block comment.
 */

export const dynamic = "force-dynamic";
/** The sweep runs detached, but the handler itself must not be pre-rendered. */
export const maxDuration = 60;

function tokenMatches(provided: string, expected: string): boolean {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    // timingSafeEqual throws on length mismatch, so compare lengths first.
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

function authorize(request: Request): NextResponse | null {
    const expected = process.env.SURVEILLANCE_SWEEP_TOKEN;
    if (!expected) {
        return NextResponse.json(
            {
                error: "Sweep endpoint disabled",
                detail: "Set SURVEILLANCE_SWEEP_TOKEN to enable scheduled refreshes.",
            },
            { status: 503 },
        );
    }

    const header = request.headers.get("authorization") ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!provided || !tokenMatches(provided, expected)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return null;
}

export async function POST(request: Request) {
    const denied = authorize(request);
    if (denied) return denied;

    if (await isSweepRunning()) {
        return NextResponse.json(
            { status: "already-running", detail: "A sweep is already in flight." },
            { status: 409 },
        );
    }

    // Detached on purpose — see the note above. Failures are logged by runSweep
    // and leave the previous cache intact, so there is nothing for the caller
    // to act on beyond "it started".
    void runSweep().catch((err) => {
        console.error("[surveillance-sweep] run failed:", err instanceof Error ? err.message : err);
    });

    return NextResponse.json(
        {
            status: "started",
            detail: "Sweep running in the background; poll GET for progress.",
            keyPrefix: KEY_PREFIX,
        },
        { status: 202 },
    );
}

export async function GET(request: Request) {
    const denied = authorize(request);
    if (denied) return denied;
    return NextResponse.json({ running: await isSweepRunning() });
}
