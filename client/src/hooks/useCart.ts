import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * The cart badge count.
 *
 * A tiny module-level cache with subscribers, rather than a context: the count
 * is needed in the header and after add-to-cart, but it is one number and a
 * full context provider for it would be heavier than the problem.
 *
 * It refreshes on mount and whenever `bumpCartCount()` is called, so the badge
 * stays correct without polling.
 */
let cached = 0;
const listeners = new Set<(count: number) => void>();

function publish(count: number) {
  cached = count;
  for (const listener of listeners) listener(count);
}

/** Call after any action that changes the cart. */
export function bumpCartCount(): void {
  void refreshCartCount();
}

export async function refreshCartCount(): Promise<void> {
  try {
    const result = await api.get<{ count: number }>('/api/cart/count');
    publish(result.count ?? 0);
  } catch {
    // Not signed in, or the request failed — an empty badge is the right
    // fallback and there is nothing useful to tell the user here.
    publish(0);
  }
}

export function useCartCount(): number {
  const [count, setCount] = useState(cached);

  useEffect(() => {
    listeners.add(setCount);
    void refreshCartCount();
    return () => {
      listeners.delete(setCount);
    };
  }, []);

  return count;
}

/** Resets the badge on sign-out. */
export function clearCartCount(): void {
  publish(0);
}

/** Debounced search value, for search-as-you-type inputs. */
export function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

/** Tracks whether the viewport is at least `query` wide. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/**
 * Fetches data for a page.
 *
 * Returns the error rather than throwing, so every caller is forced to decide
 * what to render when the request fails instead of leaving a blank screen.
 */
export function useAsync<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
): {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setError(null);

    loader(controller.signal)
      .then((result) => {
        if (!active) return;
        setData(result);
      })
      .catch((caught: unknown) => {
        if (!active || controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : 'Something went wrong.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, loading, error, reload };
}
