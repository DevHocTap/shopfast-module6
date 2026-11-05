import {
  Cable,
  Camera,
  Headphones,
  Keyboard,
  Laptop,
  LucideIcon,
  Monitor,
  Mouse,
  Package,
  Router,
  Smartphone,
  Speaker,
  Tablet,
  Watch,
} from 'lucide-react';
import { Badge } from './ui/Badge';

/** One icon per catalog category (by name), so product visuals stay meaningful without photos. */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  'Bàn phím': Keyboard,
  Camera: Camera,
  Chuột: Mouse,
  Laptop: Laptop,
  Loa: Speaker,
  'Màn hình': Monitor,
  'Máy tính bảng': Tablet,
  'Sạc & cáp': Cable,
  'Tai nghe': Headphones,
  'Thiết bị mạng': Router,
  'Điện thoại': Smartphone,
  'Đồng hồ thông minh': Watch,
};

export const categoryIcon = (category: string): LucideIcon => CATEGORY_ICONS[category] ?? Package;

/** Product visual: the category icon on a soft brand surface, with the brand name underneath. */
export function ProductTile({
  category,
  brand,
  size = 'md',
  className = '',
}: {
  category: string;
  brand: string;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const Icon = categoryIcon(category);
  return (
    <div
      className={`relative flex flex-col items-center justify-center gap-3 overflow-hidden bg-gradient-to-br from-brand-50 via-white to-brand-100 text-brand-600 ${className}`}
      aria-hidden
    >
      <span className="absolute -right-8 -top-8 size-28 rounded-full bg-brand-100/70" />
      <span className="absolute -bottom-10 -left-10 size-32 rounded-full border-[18px] border-brand-100/60" />
      <span
        className={`relative flex items-center justify-center rounded-2xl bg-white/90 shadow-card ${
          size === 'lg' ? 'size-32' : 'size-20'
        }`}
      >
        <Icon className={size === 'lg' ? 'size-24' : 'size-10'} strokeWidth={1.5} />
      </span>
      <span
        className={`relative max-w-full truncate px-4 font-bold uppercase tracking-[0.16em] text-brand-700 ${
          size === 'lg' ? 'text-base' : 'text-sm'
        }`}
      >
        {brand}
      </span>
    </div>
  );
}

/** Low or empty stock is worth flagging; plenty of stock is the normal case and stays quiet. */
export function StockBadge({ stock }: { stock: number }) {
  if (stock <= 0) return <Badge tone="danger">Hết hàng</Badge>;
  if (stock <= 5) return <Badge tone="warning">Chỉ còn {stock}</Badge>;
  return null;
}

export function StockBadgeText({ stock }: { stock: number }) {
  if (stock <= 0) return <span className="text-sm font-medium text-danger-700">Hết hàng</span>;
  if (stock <= 5)
    return <span className="text-sm font-medium text-warning-700">Chỉ còn {stock}</span>;
  return <span className="text-sm font-medium text-success-700">Còn hàng</span>;
}
