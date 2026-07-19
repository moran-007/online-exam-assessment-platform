import { contentTypeWithCharset } from '../../src/common/http/content-type';

describe('contentTypeWithCharset', () => {
  it.each(['text/plain', 'text/markdown', 'text/csv', 'application/json'])(
    'adds UTF-8 to textual type %s',
    (mimeType) => expect(contentTypeWithCharset(mimeType)).toBe(`${mimeType}; charset=utf-8`),
  );

  it('keeps binary and explicitly encoded types unchanged', () => {
    expect(contentTypeWithCharset('application/pdf')).toBe('application/pdf');
    expect(contentTypeWithCharset('text/plain; charset=gbk')).toBe('text/plain; charset=gbk');
  });
});
