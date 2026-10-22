# Cloud storage

`BLOB_READ_WRITE_TOKEN` connects a **private** Vercel Blob store. This is the only
required cloud service. The browser receives a short-lived upload token scoped to
one pathname; the store management token remains on the server.

STL and PNG files upload directly to Blob. `/api/models` validates their bytes,
writes an immutable `models/<UUID>.json` manifest, then publishes it into a
create-only `library-slots/00000.json` slot. There are at most `STL_MAX_MODELS`
slots (100 by default). Concurrent commits cannot overwrite a slot or another
model. Aborted uploads and manifests that failed publication may leave orphaned
files; removing those is an administrative maintenance task. Do not delete a file
referenced by any published slot.

Without Redis, the simple upload rate limit is **30 write requests per minute per
IP per running Function instance**. It resets when an instance restarts and is
not shared across instances. This is an abuse deterrent for the single-user MVP,
not a global traffic guarantee. Blob's publication slot quota is shared and
remains enforced across instances.

Optionally set both `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` to share the IP rate gate and 15-minute upload
reservations across instances. Redis is not the authoritative model library;
enabling or disabling it does not hide saved models.

`STL_MAX_FILE_BYTES` defaults to 50 MiB; `STL_MAX_MODELS` defaults to 100.
Without login, anyone who knows the service URL can view and add models.
Private storage protects direct Blob access, not the public application's
anonymous library API. Private downloads stream through `/api/assets`.

Model and photo listings use Vercel Runtime Cache in the Tokyo region, scoped to
the project and store, for up to two hours. Successful uploads and deletions
change a shared revision immediately; an older in-flight list cannot repopulate
a valid stale entry. Twelve-second browser polling reads this cache instead of
calling Blob `list()` on every request. Transient storage failures back off for
60 seconds; suspended/forbidden stores back off for six hours to avoid spending
more list operations during suspension. Both return 503 with `Retry-After`;
they never replace the library with an empty
successful response. A suspended Hobby Blob store still requires reactivation
or the provider's quota reset; code caching cannot undo that suspension.

After the provider reactivates a suspended store (for example after a plan
upgrade), first confirm `vercel blob get-store <store-id>` reports Active and a
private Blob read succeeds. Then, from this linked project, run
`vercel cache purge --type data --yes --scope photors-projects` to clear cached
503 responses immediately. Check both `/api/models` and `/api/photos` return
200. Purging this cache does not delete models or photos.

The opt-in managed-browser test `tests/cloud-library-sync.mjs` uploads one
synthetic model through the public production UI, then observes the real cloud
catalog from the local immersive emulator. It saves the created ID and the
pre-existing IDs to `artifacts/cloud-sync-fixture.json`; remove only that exact
test ID through the production library after verification using
`tests/cloud-library-cleanup.mjs`. Run either script with
`npx @iwsdk/cli browser run <script> --timeout 100000` in an automation-enabled
managed runtime. To retry verification without another upload, set
`CLOUD_SYNC_REUSE_FIXTURE=1` for the sync script while its fixture still exists.

Run the opt-in real-store smoke test with `npx tsx server/blob-smoke.ts` after
setting the token in `.env.local`. It creates a synthetic model, exercises
direct upload, publication, list and asset APIs, verifies create-only conflicts,
and deletes only the objects it created. It never prints credentials.

## Automatic display meshes

New commits run `meshoptimizer` on the server before publication. The original
STL stays at its immutable upload pathname. A smaller binary STL, if generated,
is saved as `optimized/<UUID>.stl`. `modelUrl` serves that display copy;
`originalModelUrl` serves the exact original. Both use private streaming routes.
Internal storage paths are excluded from API metadata.

The default target is 100,000 triangles. Geometry-aware simplification welds
identical vertices, retains topological borders/thin folds and six bounding-box
extrema, and stops at the stricter of 0.25 mm or 0.3% of mesh extent. The error
metric is an estimate from the simplifier, not a guaranteed Hausdorff tolerance
or CAD/printing accuracy. Target count is best effort: quality limits may stop
reduction earlier. Small inputs pass through unchanged; simplifier failures
preserve and serve the original with an explicit `failed` status.

`STL_DISPLAY_TRIANGLES`, `STL_DISPLAY_MAX_ERROR_MM` and
`STL_DISPLAY_RELATIVE_ERROR` configure future uploads. Existing originals and
previous display derivatives are immutable. There is no retroactive migration.
Unreferenced optimization files from aborted publication use the same manual
maintenance rules as other orphaned uploads.

## STEP assemblies

Uploads accept `.step` and `.stp` in addition to STL. STEP originals keep their extension and bytes. OpenCascade runs only in the commit Function, with explicit millimetre output, 0.15 mm tessellation deflection and 0.35 rad angular deflection. Part occurrences are already placed in assembly coordinates by the importer; the client does not apply a second transform. Hierarchy paths and contiguous triangle ranges are stored separately in `assemblies/<id>.json` and streamed through `kind=assembly`; private paths are not part of public metadata. Limits are 1000 mesh parts and one million tessellated triangles.

Each part is simplified independently, with a proportional share of the display triangle target, to retain part boundaries. `optimized/<id>.stl` always exists for STEP, even when tessellation needs no further reduction. `triangles` counts initial tessellation, while `size` counts the original STEP bytes; the converted STL can be larger than that source. Display size comparisons do not imply STEP source compression. The original is available through `kind=original` with `model/step`. The API model manifest stays small; assembly descriptions are separate assets.

PC explosion changes only the positions of disposable display meshes. It does not modify stored data. Quest uses the same part ranges and radial layout, with one grab/physics parent per assembly. Its bounding collider is rebuilt when explosion changes; gaps between parts remain part of that approximate bounding box. A single imported shape or STL has no assembly explosion control. STEP files currently use the library's generic model placeholder instead of an uploaded thumbnail. Orphan cleanup must also include the matching `assemblies/` and `optimized/` objects for unreferenced STEP imports. Runtime WASM is explicitly included in the Vercel commit Function.

## GLB

Self-contained binary glTF 2.0 is accepted with its original materials and embedded PNG/JPEG images. The commit API validates world-space bounds and counts triangles per scene node, including repeated meshes. Metadata maps Y-up metres to CAD X width / Z depth / Y height in mm. Original bytes are the display bytes and use `model/gltf-binary`. No STL decimation is applied to GLB, so original material/UV data stays intact. External URIs, excessive decoded buffers/accessors, KTX2 textures, and GPU instancing are rejected with a clear error. Client display bakes the initial pose to static meshes. NodeIO uses Draco and meshopt dependencies for validation; Draco WASM is explicitly included in the commit Function.
