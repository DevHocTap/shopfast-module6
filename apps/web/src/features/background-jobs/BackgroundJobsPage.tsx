import { ChartNoAxesColumn, CircleCheck } from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../../components/ui/States';
import { api, errorMessage } from '../../lib/api-client';
import { formatDateTime, formatVND } from '../../lib/format';
import { useToast } from '../../lib/toast';
import type { DailyRevenue, FailedJob, QueueName, QueueOverview } from '../../lib/types';
import { AsyncState, useAsync } from '../../lib/use-async';

const REFRESH_MS = 5000;

const QUEUE_LABEL: Record<QueueName, { title: string; description: string }> = {
  email: { title: 'Email', description: 'Xác nhận đơn, mã OTP, báo cáo' },
  invoice: { title: 'Hoá đơn', description: 'Tạo hoá đơn cho đơn mới' },
  'inventory-sync': { title: 'Đồng bộ tồn kho', description: 'Đẩy tồn kho sang đối tác' },
  'payment-reminder': { title: 'Nhắc thanh toán', description: 'Gửi sau 30 phút nếu chưa trả' },
  report: { title: 'Báo cáo doanh thu', description: 'Chạy lúc 00:05 mỗi ngày' },
};

const queueTitle = (name: string) => QUEUE_LABEL[name as QueueName]?.title ?? name;

/** "Today" for the business is the Vietnam calendar day, whatever the browser's time zone. */
const todayInVietnam = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

const formatDay = (isoDate: string) => isoDate.split('-').reverse().join('/');

export function BackgroundJobsPage() {
  const queues = useAsync(() => api<QueueOverview>('/admin/queues'), []);
  const failed = useAsync(() => api<FailedJob[]>('/admin/failed-jobs'), []);
  const reports = useAsync(() => api<DailyRevenue[]>('/admin/reports/daily-revenue'), []);
  const [refreshing, setRefreshing] = useState(false);

  const reloadAll = async () => {
    await Promise.all([queues.reload(), failed.reload(), reports.reload()]);
  };

  // Jobs finish within seconds: keep the numbers live while the page is open.
  useEffect(() => {
    const timer = window.setInterval(() => void reloadAll(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [queues.reload, failed.reload, reports.reload]);

  const onRefresh = async () => {
    setRefreshing(true);
    await reloadAll();
    setRefreshing(false);
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Tác vụ nền"
        description="Email, hoá đơn, đồng bộ đối tác và báo cáo chạy ở tiến trình worker. Số liệu tự cập nhật mỗi 5 giây."
        actions={
          <Button variant="secondary" loading={refreshing} onClick={() => void onRefresh()}>
            Làm mới
          </Button>
        }
      />
      <QueuesCard state={queues.state} onRetry={() => void queues.reload()} />
      <FailedJobsCard state={failed.state} onChanged={() => void reloadAll()} />
      <ReportsCard state={reports.state} onRequested={() => void reports.reload()} />
    </div>
  );
}

function SectionHeader({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {aside}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-6" aria-busy="true" aria-label="Đang tải">
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-6 w-2/3" />
    </div>
  );
}

const COUNTS: { key: 'waiting' | 'active' | 'delayed' | 'failed'; label: string }[] = [
  { key: 'waiting', label: 'Chờ' },
  { key: 'active', label: 'Đang chạy' },
  { key: 'delayed', label: 'Hẹn giờ' },
  { key: 'failed', label: 'Lỗi' },
];

function QueuesCard({ state, onRetry }: { state: AsyncState<QueueOverview>; onRetry: () => void }) {
  if (state.status === 'error') {
    return (
      <ErrorState
        title="Không đọc được hàng đợi"
        message={errorMessage(state.error)}
        onRetry={onRetry}
      />
    );
  }
  return (
    <Card>
      <SectionHeader
        title="Hàng đợi"
        aside={
          state.status === 'success' && (
            <Badge tone={state.data.pendingOutboxEvents > 0 ? 'warning' : 'neutral'}>
              {state.data.pendingOutboxEvents.toLocaleString('vi-VN')} sự kiện chờ phát
            </Badge>
          )
        }
      />
      {state.status === 'loading' ? (
        <ListSkeleton />
      ) : (
        <ul className="divide-y divide-border">
          {state.data.queues.map((queue) => (
            <li
              key={queue.name}
              className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between"
            >
              <div className="min-w-0">
                <p className="font-medium">{QUEUE_LABEL[queue.name].title}</p>
                <p className="mt-1 text-sm text-muted">{QUEUE_LABEL[queue.name].description}</p>
              </div>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4 md:w-96">
                {COUNTS.map(({ key, label }) => (
                  <div key={key}>
                    <dt className="text-sm text-muted">{label}</dt>
                    <dd
                      className={`font-semibold tabular-nums ${
                        key === 'failed' && queue.failed > 0 ? 'text-danger-700' : ''
                      }`}
                    >
                      {queue[key].toLocaleString('vi-VN')}
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function FailedJobsCard({
  state,
  onChanged,
}: {
  state: AsyncState<FailedJob[]>;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [retrying, setRetrying] = useState<string | null>(null);

  async function retry(job: FailedJob) {
    setRetrying(job.id);
    try {
      await api(`/admin/failed-jobs/${job.id}/retry`, { method: 'POST' });
      toast.success(`Đã đưa tác vụ “${queueTitle(job.queue)}” vào hàng đợi để chạy lại.`);
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setRetrying(null);
    }
  }

  if (state.status === 'error') {
    return (
      <ErrorState
        title="Không tải được danh sách tác vụ lỗi"
        message={errorMessage(state.error)}
        onRetry={onChanged}
      />
    );
  }
  if (state.status === 'success' && state.data.length === 0) {
    return (
      <EmptyState
        icon={CircleCheck}
        title="Không có tác vụ lỗi"
        description="Một tác vụ chỉ xuất hiện ở đây sau khi đã tự thử lại hết số lần cho phép mà vẫn thất bại."
      />
    );
  }
  return (
    <Card>
      <SectionHeader title="Tác vụ lỗi" />
      {state.status === 'loading' ? (
        <ListSkeleton />
      ) : (
        <ul className="divide-y divide-border">
          {state.data.map((job) => (
            <li
              key={job.id}
              className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{queueTitle(job.queue)}</Badge>
                  <span className="break-all font-mono text-sm text-muted">
                    {job.jobId ?? job.jobName}
                  </span>
                </div>
                <p className="mt-2 max-w-prose break-words">{job.reason}</p>
                <p className="mt-1 text-sm text-muted">
                  Đã thử {job.attemptsMade} lần · lỗi lúc {formatDateTime(job.failedAt)}
                </p>
              </div>
              <div className="shrink-0">
                {job.retriedAt ? (
                  <Badge tone="success">Đã chạy lại {formatDateTime(job.retriedAt)}</Badge>
                ) : (
                  <Button
                    variant="secondary"
                    loading={retrying === job.id}
                    disabled={retrying !== null}
                    onClick={() => void retry(job)}
                  >
                    Chạy lại
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ReportsCard({
  state,
  onRequested,
}: {
  state: AsyncState<DailyRevenue[]>;
  onRequested: () => void;
}) {
  const toast = useToast();
  const [running, setRunning] = useState(false);

  async function runToday() {
    setRunning(true);
    try {
      const res = await api<{ message: string }>('/admin/reports/daily-revenue', {
        method: 'POST',
        body: { date: todayInVietnam() },
      });
      toast.success(res.message);
      // The worker answers within a couple of seconds; the 5 s refresh also catches it.
      window.setTimeout(onRequested, 2000);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card>
      <SectionHeader
        title="Báo cáo doanh thu theo ngày"
        aside={
          <Button loading={running} onClick={() => void runToday()}>
            Tạo báo cáo hôm nay
          </Button>
        }
      />
      {state.status === 'loading' && <ListSkeleton />}
      {state.status === 'error' && (
        <p className="p-6 text-muted" role="alert">
          {errorMessage(state.error)}
        </p>
      )}
      {state.status === 'success' && state.data.length === 0 && (
        <div className="flex flex-col items-center px-6 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
            <ChartNoAxesColumn className="size-6" aria-hidden />
          </span>
          <p className="mt-4 font-medium">Chưa có báo cáo nào</p>
          <p className="mt-2 max-w-md text-muted">
            Báo cáo của ngày hôm trước được tạo tự động lúc 00:05. Bấm “Tạo báo cáo hôm nay” để xem
            ngay số liệu của hôm nay.
          </p>
        </div>
      )}
      {state.status === 'success' && state.data.length > 0 && (
        <ul className="divide-y divide-border">
          {state.data.map((report) => (
            <li key={report.date} className="flex flex-wrap items-center justify-between gap-2 p-6">
              <div>
                <p className="font-medium tabular-nums">{formatDay(report.date)}</p>
                <p className="mt-1 text-sm text-muted">
                  {report.orderCount.toLocaleString('vi-VN')} đơn, không tính đơn đã huỷ
                </p>
              </div>
              <span className="font-semibold tabular-nums">{formatVND(report.revenue)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
