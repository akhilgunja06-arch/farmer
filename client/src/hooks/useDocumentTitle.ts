import { useEffect } from 'react';

/** Sets the tab title, so browser history and tabs stay readable. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${title} · RythuDirect` : 'RythuDirect';
    return () => {
      document.title = previous;
    };
  }, [title]);
}
