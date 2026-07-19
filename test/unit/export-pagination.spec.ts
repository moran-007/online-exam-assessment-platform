import { cursorBatches, prismaCursorPage } from '../../src/modules/exports/export-pagination.operations';

describe('export cursor pagination', () => {
  it('advances with a stable id cursor and stops after the short page', async () => {
    const rows = Array.from({ length: 7 }, (_, index) => ({ id: `row-${index + 1}` }));
    const calls: Array<{ cursor?: string; take: number }> = [];
    const batches: string[][] = [];

    for await (const batch of cursorBatches(async (cursor, take) => {
      calls.push({ cursor, take });
      const start = cursor ? rows.findIndex((row) => row.id === cursor) + 1 : 0;
      return rows.slice(start, start + take);
    }, 3)) {
      batches.push(batch.map((row) => row.id));
    }

    expect(batches).toEqual([
      ['row-1', 'row-2', 'row-3'],
      ['row-4', 'row-5', 'row-6'],
      ['row-7'],
    ]);
    expect(calls).toEqual([
      { cursor: undefined, take: 3 },
      { cursor: 'row-3', take: 3 },
      { cursor: 'row-6', take: 3 },
    ]);
  });

  it('builds Prisma cursor arguments without skipping the first page', () => {
    expect(prismaCursorPage(undefined, 250)).toEqual({ take: 250, skip: undefined, cursor: undefined });
    expect(prismaCursorPage('row-250', 250)).toEqual({
      take: 250,
      skip: 1,
      cursor: { id: 'row-250' },
    });
  });

  it('rejects invalid batch sizes and non-advancing cursors', async () => {
    const invalid = cursorBatches(async () => [], 0);
    await expect(invalid.next()).rejects.toThrow('positive integer');

    const stalled = cursorBatches(async () => [{ id: 'same' }], 1);
    await stalled.next();
    await stalled.next();
    await expect(stalled.next()).rejects.toThrow('did not advance');
  });
});
