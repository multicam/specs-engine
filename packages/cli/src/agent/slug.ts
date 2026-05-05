/**
 * Filesystem-safe run-directory slug for `specs/.runs/<provider>--<model>/`.
 *
 * The slug is the only on-disk record linking a run dir back to the (provider,
 * model) pair that produced it; `parseSlug` is the inverse for tooling that
 * needs to surface that pairing in diffs / logs.
 *
 * Rules: lowercase; replace `/`, `:`, `_`, whitespace with `-`; collapse
 * repeated `-` inside the model half; trim leading/trailing `-` on the model
 * half. The `--` separator between provider and model is preserved verbatim.
 */
export function modelSlug(provider: string, modelName: string): string {
  const safeModel = modelName
    .toLowerCase()
    .replace(/[/:_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${provider}--${safeModel}`;
}

export function parseSlug(slug: string): { provider: string; model: string } {
  const idx = slug.indexOf("--");
  if (idx <= 0 || idx === slug.length - 2) {
    throw new Error(`invalid run slug '${slug}': expected '<provider>--<model>'`);
  }
  return { provider: slug.slice(0, idx), model: slug.slice(idx + 2) };
}
