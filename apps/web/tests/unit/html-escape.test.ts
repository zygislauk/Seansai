import { describe, expect, test } from 'vitest';
import { escapeHtml, serializeForScript } from '../../src/lib/html-escape.ts';

describe('serializeForScript', () => {
  const hostile = '</script><img src=x onerror=alert(1)> & \u2028\u2029 <!--';

  test('leaves nothing that could end the script block', () => {
    const json = serializeForScript({ title: hostile });

    expect(json).not.toMatch(/[<>&\u2028\u2029]/);
  });

  test('reads back as the same value', () => {
    const value = { title: hostile, year: 2026, poster: null };

    expect(JSON.parse(serializeForScript(value))).toEqual(value);
  });

  test('stays inert inside a real script block', () => {
    const page = new DOMParser().parseFromString(
      `<script id="data" type="application/json">${serializeForScript({ title: hostile })}</script>`,
      'text/html',
    );

    expect(page.querySelector('img')).toBeNull();
    expect(JSON.parse(page.getElementById('data')?.textContent ?? '')).toEqual({ title: hostile });
  });
});

describe('escapeHtml', () => {
  test('escapes everything with a meaning in text or an attribute', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  test.each([`" onload="alert(1)`, `' onload='alert(1)`, '"><script>alert(1)</script>'])(
    'keeps %s inside an attribute',
    (value) => {
      const page = new DOMParser().parseFromString(
        `<meta name="description" content="${escapeHtml(value)}">`,
        'text/html',
      );

      const meta = page.querySelector('meta');
      expect(meta?.getAttribute('content')).toBe(value);
      expect(meta?.getAttributeNames()).toEqual(['name', 'content']);
      expect(page.querySelector('script')).toBeNull();
    },
  );
});
