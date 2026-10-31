import { ShieldOff } from 'lucide-react';
import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import type { Role } from '../../lib/types';
import { ButtonLink } from '../ui/Button';
import { EmptyState, Skeleton } from '../ui/States';

/** Gate for pages that need a session (and optionally a role). Sends guests to /login and back. */
export function RequireAuth({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { status, hasRole } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Đang tải">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (roles && !hasRole(...roles)) {
    return (
      <EmptyState
        icon={ShieldOff}
        title="Bạn không có quyền xem trang này"
        description="Trang này dành cho nhân viên. Nếu bạn nghĩ đây là nhầm lẫn, hãy liên hệ quản trị viên."
        action={<ButtonLink to="/">Về trang sản phẩm</ButtonLink>}
      />
    );
  }
  return <>{children}</>;
}
