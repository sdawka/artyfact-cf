/**
 * Time and hash formatting shared by every view: `relTime(iso, now)` ("5 min ago", literal "unknown"
 * without a usable timestamp), `shortSha(hash)` (7 chars or "unknown") and `useNow(ms)`.
 */
export { relTime, shortSha, useNow } from "@/views/work/lib";
