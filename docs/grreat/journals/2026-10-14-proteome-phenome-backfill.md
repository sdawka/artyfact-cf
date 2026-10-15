# Proteome and Phenome evidence backfill

Links: [[../goals]], [[../roadmap]], [[../execution]]. Completed 2026-10-14T23:17:48-04:00.

Production `system.artyfact` now has two passed builds, two artifact-scoped live deployments and six labelled operator observations. Platform and site each have deployment, HTTP-service and release-catalog observations; the catalog preserves four immutable release references. They are observations made during backfill, not events emitted by historical versions or criterion passes.

Source registration is `sc-3-8d23c461`: `artyfact.app@4ccdeb27e42ff26fe67c44dcc9391d101a26bade` has the exact Git tree of released `858b7b089fedc4df07f38a39894063ae5cec5ddd`. Genome `022e58ee2ce75b79a10ae25954244d958ab27696` and its pending/unreviewed integrity status are preserved.

| Thing | Deployment | Cloudflare version |
| --- | --- | --- |
| Platform | `deployment.1` | `1628246e-4ed8-40b7-8acc-eb859fec3499` |
| Public site | `deployment.2` | `22e90e93-a158-41ff-add2-8499ac2675d3` |

Evidence: all seven deployed platform modules match `platform.builds@d32265a22ca19688e59d0bdeff50ad5041ce6734`; the site's authenticated Workflow receipt matches the same release/source and its exact Worker version. Payload schema validation and independent review pass. API readback confirms associations, both live rows in history and three events per Thing; repeat reconciliation proposes zero writes. All six System/platform/site browser checks pass at 1440px and 320px, with correct filtering and no overflow, page errors or attempted writes. Operational receipts and screenshots: `/private/tmp/artyfact-evidence-backfill/`.

Limits: no rebuild, redeploy, paid verification, Task, approval or evaluation was created. Output identity/conformance remains unknown because the release's embedded Genome differs from the intentionally preserved registered Genome. Historical live-deployment rows and unmatched CI/library/CLI records remain absent. The API's singular production summary represents one deployment; both services are verified through deployment history.

GRREAT validation passes with seven records. Authenticated versioned RPC preview proposed six creates with zero applied records; apply remains pending confirmation of a separate Artyfact destination. No remote records or earlier project associations were overwritten.
