/** Known outputs keep their immutable identity; legacy runtime builds also need their exact source commit. */
export function phenomeVersionKey(outputId: string | null | undefined, buildId: string, commit: string): string {
  return outputId ?? JSON.stringify([buildId, commit]);
}
