import { useEffect } from 'react';
import type { PageHead } from '../lib/page-head.ts';

function setMeta(name: string, content: string | null): void {
  let meta = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (content === null) {
    meta?.remove();
    return;
  }
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = name;
    document.head.append(meta);
  }
  meta.content = content;
}

function setCanonical(href: string | null): void {
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (href === null) {
    link?.remove();
    return;
  }
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.append(link);
  }
  link.href = href;
}

function setAlternates(alternates: PageHead['alternates']): void {
  for (const link of document.head.querySelectorAll('link[rel="alternate"][hreflang]')) {
    link.remove();
  }
  for (const { hreflang, href } of alternates) {
    const link = document.createElement('link');
    link.rel = 'alternate';
    link.hreflang = hreflang;
    link.href = href;
    document.head.append(link);
  }
}

/**
 * Keeps the document's head on the current page as people navigate. A snapshot's first response
 * already has these tags (scripts/prerender.ts). `null` leaves them while the page is loading, so
 * 404.html's `noindex` stays until the app knows it has a real page for the address.
 */
export function useDocumentHead(head: PageHead | null): void {
  // By value, as pages describe themselves anew on every render.
  const described = head && JSON.stringify(head);

  useEffect(() => {
    if (described === null) return;
    const { title, description, robots, canonical, alternates } = JSON.parse(described) as PageHead;
    document.title = title;
    setMeta('description', description);
    setMeta('robots', robots);
    setCanonical(canonical);
    setAlternates(alternates);
  }, [described]);
}
