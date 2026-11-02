import { Zap } from 'lucide-react';

/** Brand mark + wordmark. `inverted` is for dark brand surfaces. */
export function Logo({ inverted = false }: { inverted?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`flex size-8 items-center justify-center rounded-sm ${
          inverted ? 'bg-white text-brand-700' : 'bg-brand-600 text-white'
        }`}
        aria-hidden
      >
        <Zap className="size-4 fill-current" />
      </span>
      <span className={`text-lg font-semibold ${inverted ? 'text-white' : 'text-ink'}`}>
        Shop<span className={inverted ? 'text-brand-100' : 'text-brand-600'}>Fast</span>
      </span>
    </span>
  );
}
