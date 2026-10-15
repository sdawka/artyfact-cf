import type { MiddlewareHandler } from "hono";
import { assertImportReviewed } from "../import-review";
import type { AppEnv } from "./app";

/**
 * The import-review gate of every route that creates or starts work, or moves a Genome change forward: 409
 * `import-unreviewed` while the System's import review is pending, before the handler reads its body or creates
 * anything. Mount it after the route's auth (`requireAdmin`) so an unauthenticated caller is still 401 first.
 */
export const requireImportReviewed: MiddlewareHandler<AppEnv> = async (c, next) => {
  await assertImportReviewed(c.env, c.req.param("id")!);
  await next();
};
