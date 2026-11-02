import { Loader2 } from 'lucide-react';
import { ButtonHTMLAttributes, forwardRef } from 'react';
import { Link, LinkProps } from 'react-router-dom';

export type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700',
  secondary: 'border border-border bg-surface text-ink hover:bg-canvas',
  /** Tinted, for repeated item-level actions that must not compete with the page's primary. */
  soft: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
  ghost: 'text-ink hover:bg-canvas',
  danger: 'border border-border bg-surface text-danger-700 hover:bg-danger-50',
};

/** `icon`: square 44 px target for a single icon (give it an aria-label). */
export type ButtonSize = 'md' | 'icon';
const SIZES: Record<ButtonSize, string> = { md: 'min-h-11 px-4', icon: 'size-11 shrink-0' };

export const buttonClass = (
  variant: ButtonVariant = 'primary',
  extra = '',
  size: ButtonSize = 'md',
) => `${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${extra}`;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled,
    className = '',
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, className, size)}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export function ButtonLink({
  variant = 'primary',
  className = '',
  ...rest
}: LinkProps & { variant?: ButtonVariant }) {
  return <Link className={buttonClass(variant, className)} {...rest} />;
}
