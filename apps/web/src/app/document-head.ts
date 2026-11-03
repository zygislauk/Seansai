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

/**
 * Keeps the document's head on the current page as people navigate. A snapshot's first response
 * already has these tags (scripts/prerender.ts). `null` leaves them while the page is loading.
 */
export function useDocumentHead(head: PageHead | null): void {
  const title = head?.title;
  const description = head?.description;
  const robots = head?.robots;

  useEffect(() => {
    if (title === undefined || description === undefined || robots === undefined) return;
    document.title = title;
    setMeta('description', description);
    setMeta('robots', robots);
  }, [title, description, robots]);
}
