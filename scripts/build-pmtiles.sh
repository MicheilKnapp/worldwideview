#!/bin/sh
# Builds the tiered PMTiles archives that back map labels.
#
# Extracts are cut from the Protomaps daily planet basemap over HTTP, so the
# ~138GB source is never downloaded in full -- pmtiles fetches only the byte
# ranges each extract needs. See docs/map-labels-pmtiles.md.
#
# Usage:
#   ./build-pmtiles.sh estimate         # sizes only, no download (minutes)
#   ./build-pmtiles.sh                  # build all tiers, cheapest first
#   ./build-pmtiles.sh world            # build one tier
#   PMTILES_DIR=/srv/pmtiles ./build-pmtiles.sh
#
# Run `estimate` first. The tier zooms in tier_spec are a starting point, and a
# maxzoom that busts the disk budget is far cheaper to discover this way than
# three hours into a download.
#
# POSIX sh on purpose: this runs in the app container (node:alpine, no bash).
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PMTILES_DIR="${PMTILES_DIR:-/app/data/pmtiles}"
PMTILES_VERSION="${PMTILES_VERSION:-1.31.2}"
# Empty means "probe for the newest build". Builds are retained ~2 weeks.
PLANET_DATE="${PLANET_DATE:-}"
DOWNLOAD_THREADS="${DOWNLOAD_THREADS:-4}"

log() { echo "[build-pmtiles] $*"; }

# --- the tiers -------------------------------------------------------------
# Bounds are min-lon,min-lat,max-lon,max-lat. PMTILES_ARCHIVES must list these
# most-detailed-first; the order here is cheapest-first instead, so a size
# surprise surfaces before hours are spent on the biggest tier.
# The US tier uses a GeoJSON region rather than a bbox, because a single
# rectangle around the United States either omits Alaska, Hawaii and Puerto Rico
# or swallows most of Canada and the Pacific. See pmtiles-us-region.geojson.
US_REGION="$SCRIPT_DIR/pmtiles-us-region.geojson"

# Zooms are overridable so a tier can be re-cut without editing this file:
#   WORLD_MAXZOOM=12 ./build-pmtiles.sh estimate world
#
# What each zoom buys, measured against real tiles rather than assumed: the
# roads layer carries no labellable named ways at all below z11, only motorways
# at z11, and primary/secondary from z12. So a world tier at z10 gives place
# names everywhere but street names nowhere outside the us and na tiers. z12
# buys global street names but costs 18 GB against 3.8 GB at z10, which does not
# fit on a small VPS -- hence the conservative default and the disk check below.
# z14 is where residential streets arrive, which is why the us tier stops there.
WORLD_MAXZOOM="${WORLD_MAXZOOM:-10}"
NA_MAXZOOM="${NA_MAXZOOM:-13}"
US_MAXZOOM="${US_MAXZOOM:-14}"

tier_spec() {
    case "$1" in
        # maxzoom  then either bbox:... or region:...
        world) echo "$WORLD_MAXZOOM" ;;
        na)    echo "$NA_MAXZOOM bbox:-141.0,14.5,-52.6,70.0" ;;
        us)    echo "$US_MAXZOOM region:$US_REGION" ;;
        *)     log "unknown tier: $1 (expected world, na or us)"; exit 1 ;;
    esac
}

ALL_TIERS="world na us"
MODE="build"
if [ "${1:-}" = "estimate" ]; then
    MODE="estimate"
    shift
fi
TIERS="${*:-$ALL_TIERS}"

# --- dependencies ----------------------------------------------------------
need() { command -v "$1" >/dev/null 2>&1; }

if ! need curl; then
    if need apk; then log "installing curl"; apk add --no-cache curl >/dev/null
    elif need apt-get; then log "installing curl"; apt-get -qq update && apt-get -qq install -y curl
    else log "curl is required"; exit 1
    fi
fi

# --- the pmtiles CLI -------------------------------------------------------
PMTILES_BIN="${PMTILES_BIN:-$PMTILES_DIR/.bin/pmtiles}"
if [ ! -x "$PMTILES_BIN" ]; then
    case "$(uname -m)" in
        x86_64|amd64) ARCH="x86_64" ;;
        aarch64|arm64) ARCH="arm64" ;;
        *) log "unsupported architecture: $(uname -m)"; exit 1 ;;
    esac
    mkdir -p "$(dirname "$PMTILES_BIN")"
    URL="https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/go-pmtiles_${PMTILES_VERSION}_Linux_${ARCH}.tar.gz"
    log "fetching pmtiles CLI v${PMTILES_VERSION} (${ARCH})"
    curl -fsSL "$URL" | tar xz -C "$(dirname "$PMTILES_BIN")" pmtiles
    chmod +x "$PMTILES_BIN"
fi

# --- the planet source -----------------------------------------------------
# Protomaps publishes one build per day at build.protomaps.com/YYYYMMDD.pmtiles
# and keeps roughly a fortnight. There is no bucket listing, so the newest is
# found by probing backwards rather than assuming today's exists yet.

# Date arithmetic is not portable: GNU takes -d "-N days", BSD takes -v-Nd, and
# busybox (Alpine) takes neither but does understand @epoch. Try all three and
# validate, so a silently misparsed date cannot become a 404 loop.
days_ago_utc() {
    _d="$1"
    for _out in \
        "$(date -u -d "@$(( $(date -u +%s) - _d * 86400 ))" +%Y%m%d 2>/dev/null || true)" \
        "$(date -u -d "-${_d} days" +%Y%m%d 2>/dev/null || true)" \
        "$(date -u -v-"${_d}"d +%Y%m%d 2>/dev/null || true)"
    do
        case "$_out" in
            [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) echo "$_out"; return 0 ;;
        esac
    done
    return 1
}

if [ -z "$PLANET_DATE" ]; then
    log "probing for the newest planet build"
    i=0
    while [ "$i" -le 16 ]; do
        DATE="$(days_ago_utc "$i")" || { log "cannot compute dates on this system; set PLANET_DATE"; exit 1; }
        if curl -fsSI "https://build.protomaps.com/${DATE}.pmtiles" >/dev/null 2>&1; then
            PLANET_DATE="$DATE"
            break
        fi
        i=$((i + 1))
    done
    [ -n "$PLANET_DATE" ] || { log "no planet build found in the last 16 days"; exit 1; }
fi

PLANET="https://build.protomaps.com/${PLANET_DATE}.pmtiles"
PLANET_BYTES="$(curl -fsSI "$PLANET" | tr -d '\r' | awk 'tolower($1)=="content-length:"{print $2}')"
[ -n "$PLANET_BYTES" ] || { log "$PLANET is not readable"; exit 1; }
log "source $PLANET ($((PLANET_BYTES / 1000000000)) GB)"

# --- disk safety -----------------------------------------------------------
# These archives commonly land on the same filesystem as everything else on a
# small VPS -- Docker volumes live under /var/lib/docker. Filling it does not
# merely fail this build: Postgres and most other services fail hard when they
# cannot write. So every tier is measured with --dry-run first and refused if it
# would not leave KEEP_FREE_GB behind.
KEEP_FREE_GB="${KEEP_FREE_GB:-8}"

# Available kibibytes on the filesystem holding a directory.
avail_kb() {
    df -P -k "$1" | awk 'NR==2 {print $4}'
}

# Parses "... for an archive size of 3.9 GB" into kibibytes.
size_to_kb() {
    # The decision belongs in END, not per line: the CLI prints several lines and
    # only the last one carries the size, so exiting early on a non-matching
    # line would discard the answer.
    awk '
        {
            for (i = 1; i <= NF; i++) {
                if ($i == "size" && $(i+1) == "of") { n = $(i+2); u = $(i+3) }
            }
        }
        END {
            if (n == "") exit 1
            if (u == "GB") print int(n * 1000000)
            else if (u == "MB") print int(n * 1000)
            else if (u == "KB") print int(n)
            else if (u == "TB") print int(n * 1000000000)
            else exit 1
        }'
}

# --- run -------------------------------------------------------------------
mkdir -p "$PMTILES_DIR"

# build.protomaps.com sits behind a CDN that returns 503 to bursts of requests,
# including the tiny header read every extract opens with. That failure looks
# identical to a missing archive, so retry with backoff rather than giving up.
extract_with_retry() {
    _attempt=1
    while :; do
        if "$PMTILES_BIN" extract "$@"; then return 0; fi
        if [ "$_attempt" -ge 6 ]; then
            log "giving up after $_attempt attempts"
            return 1
        fi
        _wait=$((_attempt * 25))
        log "attempt $_attempt failed (the CDN throttles); retrying in ${_wait}s"
        sleep "$_wait"
        _attempt=$((_attempt + 1))
    done
}

for TIER in $TIERS; do
    SPEC="$(tier_spec "$TIER")"
    MAXZOOM="$(echo "$SPEC" | cut -d' ' -f1)"
    AREA="$(echo "$SPEC" | cut -d' ' -s -f2)"
    OUT="$PMTILES_DIR/${TIER}.pmtiles"

    # One flag, resolved once, so the size probe and the real extract cannot
    # disagree about what is being cut.
    AREA_FLAG=""
    case "$AREA" in
        bbox:*)
            AREA_FLAG="--bbox=${AREA#bbox:}"
            ;;
        region:*)
            REGION="${AREA#region:}"
            [ -f "$REGION" ] || { log "region file not found: $REGION"; exit 1; }
            AREA_FLAG="--region=$REGION"
            ;;
    esac

    log "--- $TIER (maxzoom=$MAXZOOM${AREA:+ $AREA}) ${MODE}"

    if [ "$MODE" = "estimate" ]; then
        extract_with_retry "$PLANET" "$OUT" "--maxzoom=$MAXZOOM" ${AREA_FLAG:+"$AREA_FLAG"} --dry-run || exit 1
        continue
    fi

    # Measure before committing. A dry run costs a handful of HTTP requests and
    # downloads nothing, which is cheap insurance against filling the disk.
    PROBE="$("$PMTILES_BIN" extract "$PLANET" "$OUT" "--maxzoom=$MAXZOOM"         ${AREA_FLAG:+"$AREA_FLAG"} --dry-run 2>&1)" || PROBE=""
    NEED_KB="$(printf '%s
' "$PROBE" | size_to_kb 2>/dev/null)" || NEED_KB=""
    if [ -z "$NEED_KB" ]; then
        log "could not measure $TIER before building; refusing to guess"
        exit 1
    fi

    HAVE_KB="$(avail_kb "$PMTILES_DIR")"
    KEEP_KB=$((KEEP_FREE_GB * 1000000))
    log "$TIER needs $((NEED_KB / 1000000)) GB; $((HAVE_KB / 1000000)) GB free on $(df -P "$PMTILES_DIR" | awk 'NR==2 {print $1}'), keeping $KEEP_FREE_GB GB back"
    if [ $((NEED_KB + KEEP_KB)) -gt "$HAVE_KB" ]; then
        log "REFUSING to build $TIER: it would leave under $KEEP_FREE_GB GB free."
        log "  Lower the zoom (WORLD_MAXZOOM / NA_MAXZOOM / US_MAXZOOM),"
        log "  free disk space, or override KEEP_FREE_GB if you are sure."
        exit 1
    fi

    # Write to .partial and move on success: a half-written archive left at the
    # real path would be opened by the app and fail every tile read.
    START="$(date -u +%s)"
    extract_with_retry "$PLANET" "$OUT.partial" "--maxzoom=$MAXZOOM"         "--download-threads=$DOWNLOAD_THREADS" ${AREA_FLAG:+"$AREA_FLAG"} || exit 1
    mv "$OUT.partial" "$OUT"
    log "$TIER done in $(( ($(date -u +%s) - START) / 60 ))m -- $(du -h "$OUT" | cut -f1)"
done

[ "$MODE" = "estimate" ] && { log "estimates only, nothing written"; exit 0; }

log "archives in $PMTILES_DIR:"
du -h "$PMTILES_DIR"/*.pmtiles
echo
log "set this in Coolify (most detailed FIRST):"
printf '  PMTILES_ARCHIVES='
SEP=""
for TIER in us na world; do
    [ -f "$PMTILES_DIR/${TIER}.pmtiles" ] || continue
    printf '%s%s/%s.pmtiles' "$SEP" "$PMTILES_DIR" "$TIER"
    SEP=","
done
echo
