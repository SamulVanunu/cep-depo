type EnvironmentSource = Readonly<Record<string, string | undefined>>;

/**
 * Server-side gate for JSON catalog generation. Only the exact lowercase value
 * 'true' enables it; every other value (missing, blank, 'false', 'TRUE') keeps
 * admin publishing on the RPC-only path with no Storage or audit side effects.
 */
export function isCatalogJsonServerEnabled(
  source: EnvironmentSource = process.env,
): boolean {
  return source.CATALOG_JSON_ENABLED === 'true';
}
