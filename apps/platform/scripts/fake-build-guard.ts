/**
 * `FAKE_ARTIFACTS=1` bakes fake vars (in-memory Artifacts, the fake System One, a known admin token) into the generated
 * Worker config. That is for the dev server and the fake e2e suite only: a `vite build` with it could reach a deploy,
 * so it is refused unless the fake e2e flag `ARTYFACT_E2E_FAKE=1` says the build is for that suite.
 */
export function assertNoFakeBuild(command: string, env: Record<string, string | undefined>): void {
  if (command === "build" && env.FAKE_ARTIFACTS === "1" && env.ARTYFACT_E2E_FAKE !== "1") {
    throw new Error("FAKE_ARTIFACTS=1 is refused for `vite build`: it would bake fake vars and a known admin token into a deployable Worker. Unset it, or set ARTYFACT_E2E_FAKE=1 for a fake e2e build.");
  }
}
