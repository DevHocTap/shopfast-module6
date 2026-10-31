import { useState } from 'react';
import { ComponentCheck, ReadinessReport, useSystemStatus } from './use-system-status';

const OVERALL = {
  ok: { label: 'Mọi dịch vụ hoạt động bình thường', tone: 'success' },
  degraded: {
    label: 'Hệ thống vẫn phục vụ nhưng chậm hơn (bộ nhớ đệm gián đoạn)',
    tone: 'warning',
  },
  down: { label: 'Hệ thống đang gián đoạn — không kết nối được cơ sở dữ liệu', tone: 'danger' },
} as const;

const TONE_CLASSES = {
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-danger-50 text-danger-700',
} as const;

export function SystemStatusPage() {
  const { state, refresh } = useSystemStatus();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-2xl items-center px-4">
          <span className="text-lg font-semibold text-brand-700">ShopFast</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-12">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Trạng thái hệ thống</h1>
            <p className="mt-2 text-muted">Kết nối của API tới cơ sở dữ liệu và bộ nhớ đệm.</p>
          </div>
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={refreshing || state.kind === 'loading'}
            className="min-h-11 rounded-sm bg-brand-600 px-4 font-medium text-white transition-colors duration-150 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {refreshing ? 'Đang kiểm tra…' : 'Kiểm tra lại'}
          </button>
        </div>

        {state.kind === 'loading' && <StatusSkeleton />}
        {state.kind === 'error' && <StatusError message={state.message} onRetry={onRefresh} />}
        {state.kind === 'loaded' && (
          <StatusReport report={state.report} checkedAt={state.checkedAt} />
        )}
      </main>
    </div>
  );
}

function StatusReport({ report, checkedAt }: { report: ReadinessReport; checkedAt: Date }) {
  const overall = OVERALL[report.status];
  return (
    <section className="rounded-lg bg-surface shadow-card" aria-live="polite">
      <p className={`rounded-t-lg px-6 py-4 font-medium ${TONE_CLASSES[overall.tone]}`}>
        {overall.label}
      </p>
      <ul className="divide-y divide-border px-6">
        <ComponentRow name="Cơ sở dữ liệu (PostgreSQL)" check={report.checks.database} />
        <ComponentRow name="Bộ nhớ đệm (Redis)" check={report.checks.redis} />
      </ul>
      <p className="border-t border-border px-6 py-4 text-sm text-muted">
        Phiên bản <code className="font-mono">{report.version.slice(0, 7)}</code> · kiểm tra lúc{' '}
        {checkedAt.toLocaleTimeString('vi-VN')}
      </p>
    </section>
  );
}

function ComponentRow({ name, check }: { name: string; check: ComponentCheck }) {
  const up = check.status === 'up';
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-4">
      <div className="min-w-0">
        <p className="font-medium">{name}</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted">{check.latencyMs} ms</span>
        <span
          className={`rounded-sm px-2 py-1 text-sm font-medium ${up ? TONE_CLASSES.success : TONE_CLASSES.danger}`}
        >
          {up ? 'Hoạt động' : 'Gián đoạn'}
        </span>
      </div>
    </li>
  );
}

function StatusSkeleton() {
  return (
    <div className="rounded-lg bg-surface p-6 shadow-card" aria-busy="true" aria-label="Đang tải">
      <div className="h-6 w-2/3 animate-pulse rounded-sm bg-border" />
      <div className="mt-6 h-4 w-full animate-pulse rounded-sm bg-border" />
      <div className="mt-4 h-4 w-full animate-pulse rounded-sm bg-border" />
    </div>
  );
}

function StatusError({ message, onRetry }: { message: string; onRetry: () => Promise<void> }) {
  return (
    <div className="rounded-lg bg-surface p-6 shadow-card" role="alert">
      <p className="font-medium text-danger-700">Không lấy được trạng thái hệ thống</p>
      <p className="mt-2 text-muted">{message}</p>
      <button
        type="button"
        onClick={() => void onRetry()}
        className="mt-4 min-h-11 rounded-sm border border-border px-4 font-medium transition-colors duration-150 hover:bg-canvas"
      >
        Thử lại
      </button>
    </div>
  );
}
