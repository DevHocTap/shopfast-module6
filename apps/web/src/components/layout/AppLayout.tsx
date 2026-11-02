import { LogOut, ShoppingCart } from 'lucide-react';
import { Link, NavLink, Outlet, ScrollRestoration, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useCart } from '../../lib/cart';
import type { Role } from '../../lib/types';
import { Logo } from '../Logo';
import { ButtonLink } from '../ui/Button';

interface NavItem {
  to: string;
  label: string;
  roles?: Role[];
  requiresAuth?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Sản phẩm' },
  { to: '/orders', label: 'Đơn hàng của tôi', requiresAuth: true },
  { to: '/support', label: 'Hỗ trợ', roles: ['CUSTOMER'] },
  { to: '/desk', label: 'CSKH', roles: ['SUPPORT', 'ADMIN'] },
  { to: '/warehouse', label: 'Kho', roles: ['WAREHOUSE', 'ADMIN'] },
  { to: '/jobs', label: 'Tác vụ nền', roles: ['ADMIN'] },
  { to: '/status', label: 'Hệ thống', roles: ['ADMIN'] },
];

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `inline-flex min-h-11 shrink-0 items-center rounded-sm px-3 text-sm font-medium transition-colors duration-150 ${
    isActive ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-canvas hover:text-ink'
  }`;

export function AppLayout() {
  const { status, user, logout, hasRole } = useAuth();
  const { count } = useCart();
  const navigate = useNavigate();
  const items = NAV.filter(
    (item) =>
      (!item.requiresAuth || status === 'authenticated') && (!item.roles || hasRole(...item.roles)),
  );

  const links = items.map((item) => (
    <NavLink key={item.to} to={item.to} end={item.to === '/'} className={navLinkClass}>
      {item.label}
    </NavLink>
  ));

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
          <NavLink to="/" className="mr-2 shrink-0 rounded-sm" aria-label="ShopFast — trang chủ">
            <Logo />
          </NavLink>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Điều hướng chính">
            {links}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {status === 'authenticated' && (
              <NavLink
                to="/cart"
                className="relative flex size-11 items-center justify-center rounded-sm text-ink hover:bg-canvas"
                aria-label={`Giỏ hàng, ${count} sản phẩm`}
              >
                <ShoppingCart className="size-5" aria-hidden />
                {count > 0 && (
                  <span className="absolute right-1 top-1 flex min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-sm font-semibold leading-5 text-white">
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </NavLink>
            )}
            {status === 'authenticated' && user ? (
              <>
                <span className="hidden items-center gap-2 pl-2 text-sm font-medium sm:flex">
                  <span
                    className="flex size-8 items-center justify-center rounded-full bg-brand-50 font-semibold text-brand-700"
                    aria-hidden
                  >
                    {initialOf(user.fullName)}
                  </span>
                  <span className="max-w-40 truncate">{user.fullName}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    // Leave protected pages first: otherwise the login redirect would remember
                    // this page and send the next person who signs in back to it.
                    navigate('/', { replace: true });
                    void logout();
                  }}
                  className="flex size-11 items-center justify-center rounded-sm text-muted hover:bg-canvas hover:text-ink"
                  aria-label="Đăng xuất"
                  title="Đăng xuất"
                >
                  <LogOut className="size-5" aria-hidden />
                </button>
              </>
            ) : (
              status === 'anonymous' && (
                <ButtonLink to="/login" variant="secondary">
                  Đăng nhập
                </ButtonLink>
              )
            )}
          </div>
        </div>
        <nav
          className="no-scrollbar flex gap-1 overflow-x-auto border-t border-border px-2 py-1 md:hidden"
          aria-label="Điều hướng chính"
        >
          {links}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:py-12">
        <Outlet />
      </main>

      <SiteFooter />
      {/* New pages open at the top; back/forward restores the previous position. */}
      <ScrollRestoration />
    </div>
  );
}

/** First letter of the given name (Vietnamese names put it last: "Nguyễn Văn An" → "A"). */
function initialOf(fullName: string): string {
  const parts = fullName.trim().split(/s+/);
  return (parts[parts.length - 1]?.[0] ?? '?').toUpperCase();
}

const FOOTER_LINKS = [
  {
    title: 'Mua sắm',
    links: [
      { to: '/', label: 'Tất cả sản phẩm' },
      { to: '/cart', label: 'Giỏ hàng' },
      { to: '/orders', label: 'Đơn hàng của tôi' },
    ],
  },
  {
    title: 'Hỗ trợ',
    links: [
      { to: '/support', label: 'Gửi yêu cầu hỗ trợ' },
      { to: '/login', label: 'Đăng nhập' },
      { to: '/register', label: 'Tạo tài khoản' },
    ],
  },
];

function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-4 text-sm text-muted">
            Thiết bị công nghệ chính hãng: điện thoại, laptop, âm thanh, phụ kiện. Đặt hàng nhanh,
            theo dõi đơn ngay trên màn hình.
          </p>
        </div>
        {FOOTER_LINKS.map((group) => (
          <nav key={group.title} aria-label={group.title}>
            <h2 className="text-sm font-semibold">{group.title}</h2>
            <ul className="mt-2">
              {group.links.map((link) => (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    className="inline-flex min-h-11 items-center text-sm text-muted transition-colors duration-150 hover:text-ink"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-border">
        <p className="mx-auto max-w-6xl px-4 py-6 text-sm text-muted">
          © {new Date().getFullYear()} ShopFast. Bảo lưu mọi quyền.
        </p>
      </div>
    </footer>
  );
}
