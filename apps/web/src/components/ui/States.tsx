import { CircleAlert, LucideIcon } from 'lucide-react';
import { ReactNode } from 'react';
import { Button } from './Button';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg bg-surface shadow-card ${className}`}>{children}</div>;
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-sm bg-border ${className}`} aria-hidden />;
}

/** Shown when there is legitimately nothing yet: explain why and offer the next step. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
        <Icon className="size-6" aria-hidden />
      </span>
      <h2 className="mt-4 text-lg font-semibold">{title}</h2>
      <p className="mt-2 max-w-md text-muted">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </Card>
  );
}

/** Says what went wrong (message comes from the API in Vietnamese) and how to recover. */
export function ErrorState({
  title = 'Không tải được dữ liệu',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Card className="p-6">
      <div role="alert" className="flex items-start gap-3">
        <CircleAlert className="mt-px size-5 shrink-0 text-danger-700" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium text-danger-700">{title}</p>
          <p className="mt-1 text-muted">{message}</p>
          {onRetry && (
            <Button variant="secondary" className="mt-4" onClick={onRetry}>
              Thử lại
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

export function InlineAlert({
  tone,
  children,
}: {
  tone: 'danger' | 'warning';
  children: ReactNode;
}) {
  const tones = {
    danger: 'bg-danger-50 text-danger-700',
    warning: 'bg-warning-50 text-warning-700',
  };
  return (
    <div role="alert" className={`flex items-start gap-2 rounded-sm p-3 text-sm ${tones[tone]}`}>
      <CircleAlert className="mt-px size-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description && <p className="mt-2 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
