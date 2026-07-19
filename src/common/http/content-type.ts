const UTF8_APPLICATION_TYPES = new Set([
  'application/json',
  'application/javascript',
  'application/xml',
]);

export function contentTypeWithCharset(mimeType: string) {
  if (/;\s*charset=/i.test(mimeType)) return mimeType;
  const baseType = mimeType.split(';', 1)[0].trim().toLowerCase();
  return baseType.startsWith('text/') || UTF8_APPLICATION_TYPES.has(baseType)
    ? `${mimeType}; charset=utf-8`
    : mimeType;
}
