// UI test setup: load the view-hint resolver (a lazy chunk in the app) so pure helpers see the templates' hints.
import { loadKindViews } from "@/model/kinds";

await loadKindViews();
