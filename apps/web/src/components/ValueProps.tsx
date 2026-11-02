import { BadgeCheck, LifeBuoy, Radio } from 'lucide-react';

/** What the shop actually offers: every point here is backed by a real feature. */
export const VALUE_PROPS = [
  {
    icon: BadgeCheck,
    title: 'Hàng chính hãng',
    text: 'Bảo hành 12 tháng từ thương hiệu.',
  },
  {
    icon: Radio,
    title: 'Theo dõi đơn trực tiếp',
    text: 'Trạng thái đơn cập nhật ngay trên màn hình.',
  },
  {
    icon: LifeBuoy,
    title: 'Hỗ trợ tận tình',
    text: 'Gửi yêu cầu và trao đổi với nhân viên ngay trong tài khoản.',
  },
] as const;

export function ValueProps({
  tone = 'light',
  stacked = false,
}: {
  tone?: 'light' | 'dark';
  stacked?: boolean;
}) {
  const dark = tone === 'dark';
  return (
    <ul className={`grid gap-6 ${stacked ? '' : 'sm:grid-cols-3'}`}>
      {VALUE_PROPS.map(({ icon: Icon, title, text }) => (
        <li key={title} className="flex items-start gap-3">
          <span
            className={`flex size-10 shrink-0 items-center justify-center rounded-sm ${
              dark ? 'bg-white/10 text-white' : 'bg-brand-50 text-brand-700'
            }`}
            aria-hidden
          >
            <Icon className="size-5" />
          </span>
          <div className="min-w-0">
            <p className={`font-medium ${dark ? 'text-white' : ''}`}>{title}</p>
            <p className={`mt-1 text-sm ${dark ? 'text-brand-100' : 'text-muted'}`}>{text}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
