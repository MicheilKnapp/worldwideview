# Surveillance Infrastructure

Publicly-mapped surveillance devices from OpenStreetMap, rendered on the globe
with facing direction.

| Tier | What it is | Verified role |
|---|---|---|
| ALPR | Automatic licence plate readers (Flock Safety, Motorola, Genetec, …) | yes |
| Gunshot detector | Acoustic gunshot detection sensors | yes |
| Facial recognition | Cameras tagged `surveillance:type=AFR` | yes |
| Public-space camera | Municipal cameras in town/street zones | **no — operator unknown** |

The typed tiers match on `surveillance:type` alone and deliberately do not
also require `man_made=surveillance`. Requiring both drops devices: AFR
returns 67 nodes on the tag alone but only 3 when gated on `man_made`.

## The unverified tier

OpenStreetMap has no `surveillance:type=police`, and `surveillance:operator` is
effectively unused (its most common value appears 261 times worldwide). Device
operator therefore **cannot** be established from OSM tagging.

The public-space tier is an inferred proxy built from `surveillance=public` plus
`surveillance:zone=town|street`. It is not a list of police cameras, and the UI
never presents it as one: the legend marks it with an asterisk, the tier label
reads "operator unverified", and each entity carries `verified: false`.

## Rendering

Devices are billboards with an inline SVG view cone rotated to the tagged
bearing. 99.97% of direction-tagged devices resolve to a bearing, including the
multi-value form (`direction=0;90;180;270`) used by multi-lane gantries — those
also expose every bearing as `allDirections` in the Intel panel.

Zoomed out, the layer draws pre-computed 1° cluster cells as points. Zoom past a
12° camera span and it swaps to individual devices for the visible rectangle
only. The full dataset is ~157k devices and is never loaded at once.

## Data flow

```
OpenStreetMap
  -> Overpass (4 mirrors, 6-hourly)      [surveillance-infrastructure seeder]
  -> Redis: 20° region tiles + summary
  -> /api/plugins/surveillance-infrastructure?bbox=...   [bounded read]
  -> this plugin
```

The plugin never calls Overpass directly. `getPollingInterval()` returns 0
because what to fetch depends on where the camera points, which `fetch()` cannot
know — the globe component owns loading after the initial summary paint.

## Attribution

Data © OpenStreetMap contributors, licensed under
[ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Responses carry the
licence in `X-Data-License` and a `rel="license"` link header, and every entity
carries it in `properties.license`.

Tiering approach informed by [FoggedLens/deflock](https://github.com/FoggedLens/deflock)
(MIT). No DeFlock code is used and no DeFlock service is called.

---

## Deploying to a self-hosted instance

The shipped artifact is `public/plugins/surveillance-infrastructure/frontend.mjs`
— committed to the repo and copied into the Docker image, following the same
pattern as `public/plugins/iss/frontend.mjs`. The sources here are the input to
that bundle; `public/plugins-local/` is the dev-only output and is gitignored.

### 1. Rebuild the bundle after changing sources

```bash
node -e "import('./scripts/sync-local-plugins.mjs').then(m => m.syncAll())"
cp public/plugins-local/surveillance-infrastructure/frontend.mjs \
   public/plugins/surveillance-infrastructure/frontend.mjs
```

The build externalises `react` and the plugin SDK onto `globalThis.__WWV_HOST__`,
so the bundle has no npm or CDN dependency at runtime.

### 2. Register the plugin

`installed_plugins` holds the manifest in its `config` column. Insert the row
directly (this is not part of the app's seed data, matching how `iss` was added):

```sql
INSERT INTO installed_plugins (id, "tenantId", "pluginId", version, enabled, config)
VALUES (
  gen_random_uuid(), NULL, 'surveillance-infrastructure', '1.0.0', true,
  '{"id":"surveillance-infrastructure",
    "name":"Surveillance Infrastructure",
    "version":"1.0.0",
    "type":"data-layer",
    "format":"bundle",
    "trust":"unverified",
    "category":"infrastructure",
    "icon":"Cctv",
    "capabilities":["data:own","globe:overlay","network:fetch"],
    "entry":"/plugins/surveillance-infrastructure/frontend.mjs"}'
);
```

### 3. Fill the cache

The sweep normally runs in a data-engine seeder, but an instance reporting
`engine: false` at `/api/health` has no engine to run it. In that case use the
sweep route instead — it needs only Redis, which the app already has.

Set a token in the environment:

```
SURVEILLANCE_SWEEP_TOKEN=<a long random string>
```

Then trigger it once by hand, and from cron every six hours (the route returns
`202` immediately; a full sweep takes minutes):

```bash
curl -fsS -X POST -H "Authorization: Bearer $SURVEILLANCE_SWEEP_TOKEN" \
  https://<your-instance>/api/plugins/surveillance-infrastructure/sweep
```

```crontab
17 */6 * * * curl -fsS -X POST -H "Authorization: Bearer <token>" https://<your-instance>/api/plugins/surveillance-infrastructure/sweep >/dev/null
```

Progress: `GET` the same URL for `{"running":true|false}`, and check `fetchedAt`
on the read route. Until the first sweep finishes the read route answers `503`
with "Surveillance cache is empty" rather than an empty map.

If you later bring the data engine up, deploy the seeder package instead and
stop triggering this route — both write identical keys, so run only one.
