export const EXPORT_QUERY_BATCH_SIZE = 250;

export async function* cursorBatches<T extends { id: string }>(
  loadPage: (cursor: string | undefined, take: number) => Promise<T[]>,
  batchSize = EXPORT_QUERY_BATCH_SIZE,
) {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('Export batch size must be a positive integer');
  }

  let cursor: string | undefined;
  while (true) {
    const page = await loadPage(cursor, batchSize);
    if (!page.length) return;
    yield page;
    if (page.length < batchSize) return;

    const nextCursor = page[page.length - 1].id;
    if (nextCursor === cursor) throw new Error('Export cursor did not advance');
    cursor = nextCursor;
  }
}

export function prismaCursorPage(cursor: string | undefined, take: number) {
  return {
    take,
    skip: cursor ? 1 : undefined,
    cursor: cursor ? { id: cursor } : undefined,
  };
}
