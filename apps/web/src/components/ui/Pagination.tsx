import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';

export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav className="mt-8 flex items-center justify-center gap-4" aria-label="Phân trang">
      <Button variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        <ChevronLeft className="size-4" aria-hidden />
        Trước
      </Button>
      <span className="text-sm text-muted">
        Trang {page} / {totalPages}
      </span>
      <Button variant="secondary" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Sau
        <ChevronRight className="size-4" aria-hidden />
      </Button>
    </nav>
  );
}
