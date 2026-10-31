import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '../../lib/api-client';

export interface ComponentCheck {
  status: 'up' | 'down';
  latencyMs: number;
}

export interface ReadinessReport {
  status: 'ok' | 'degraded' | 'down';
  version: string;
  checks: { database: ComponentCheck; redis: ComponentCheck };
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; report: ReadinessReport; checkedAt: Date };

export function useSystemStatus() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const refresh = useCallback(async () => {
    setState((current) => (current.kind === 'loaded' ? current : { kind: 'loading' }));
    try {
      // 503 still carries a full report (database down) — show it instead of a generic error.
      const report = await apiGet<ReadinessReport>('/health/ready', [503]);
      setState({ kind: 'loaded', report, checkedAt: new Date() });
    } catch (error) {
      setState({ kind: 'error', message: (error as Error).message });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { state, refresh };
}
