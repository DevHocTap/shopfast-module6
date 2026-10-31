import { DependencyList, useCallback, useEffect, useRef, useState } from 'react';

export type AsyncState<T> =
  { status: 'loading' } | { status: 'error'; error: Error } | { status: 'success'; data: T };

/**
 * Loads data when `deps` change and ignores responses of superseded requests.
 * `reload` keeps the current data on screen while refreshing (no flash back to the skeleton).
 */
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList) {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const requestId = useRef(0);
  const stableLoad = useCallback(load, deps);

  const run = useCallback(
    async (showSkeleton: boolean) => {
      const id = ++requestId.current;
      if (showSkeleton) setState({ status: 'loading' });
      try {
        const data = await stableLoad();
        if (id === requestId.current) setState({ status: 'success', data });
      } catch (error) {
        if (id === requestId.current) setState({ status: 'error', error: error as Error });
      }
    },
    [stableLoad],
  );

  useEffect(() => {
    void run(true);
  }, [run]);

  const reload = useCallback(() => run(false), [run]);
  return { state, reload, setState };
}
