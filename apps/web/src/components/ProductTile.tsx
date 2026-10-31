/** Product visual placeholder until real images exist: the brand name on a neutral tile. */
export function ProductTile({ brand, className = '' }: { brand: string; className?: string }) {
  return (
    <div
      className={`flex items-center justify-center rounded-sm bg-canvas px-4 text-lg font-semibold uppercase tracking-wide text-muted ring-1 ring-inset ring-border ${className}`}
      aria-hidden
    >
      <span className="truncate">{brand}</span>
    </div>
  );
}

export function StockBadgeText({ stock }: { stock: number }) {
  if (stock <= 0) return <span className="text-sm font-medium text-danger-700">Hết hàng</span>;
  if (stock <= 5)
    return <span className="text-sm font-medium text-warning-700">Chỉ còn {stock}</span>;
  return <span className="text-sm font-medium text-success-700">Còn hàng</span>;
}
