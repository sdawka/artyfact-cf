/**
 * Flagship flags of the platform Worker itself (`FLAGS`, app `artyfact`). The test configs omit the binding, so an
 * absent binding means the flag is off; a provider error is logged and also reads as off, never as a 500.
 */
export const CAT_MODE_FLAG = "cat-mode";

export async function catMode(env: { FLAGS?: Pick<Flagship, "getBooleanValue"> }): Promise<boolean> {
  if (!env.FLAGS) return false;
  try {
    return (await env.FLAGS.getBooleanValue(CAT_MODE_FLAG, false)) === true;
  } catch (err) {
    console.error(`flagship: ${CAT_MODE_FLAG} evaluation failed`, err);
    return false;
  }
}
