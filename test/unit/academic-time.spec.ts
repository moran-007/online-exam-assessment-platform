import { addUtcDays, formatDateOnly, parseDateOnly, zonedDateTime } from '../../src/modules/academic-operations/academic-time';

describe('academic time helpers', () => {
  it('generates stable Asia/Shanghai instants from local dates', () => {
    expect(zonedDateTime('2026-07-20', 18 * 60, 'Asia/Shanghai').toISOString()).toBe('2026-07-20T10:00:00.000Z');
    expect(zonedDateTime('2026-07-20', 24 * 60, 'Asia/Shanghai').toISOString()).toBe('2026-07-20T16:00:00.000Z');
  });

  it('keeps date-only calculations independent from server timezone', () => {
    const start = parseDateOnly('2026-07-20');
    expect(start.getUTCDay()).toBe(1);
    expect(formatDateOnly(addUtcDays(start, 7))).toBe('2026-07-27');
  });

  it('rejects invalid calendar dates', () => {
    expect(() => parseDateOnly('2026-02-30')).toThrow('日期无效');
  });
});
