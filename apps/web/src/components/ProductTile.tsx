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
      className={`flex flex-col items-center justify-center gap-3 bg-brand-50 text-brand-600 ${className}`}
      aria-hidden
    >
      <Icon className={size === 'lg' ? 'size-24' : 'size-12'} strokeWidth={1.5} />
      <span
        className={`max-w-full truncate px-4 font-semibold uppercase tracking-wider text-brand-700 ${
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
