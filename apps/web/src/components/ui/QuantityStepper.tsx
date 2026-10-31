import { Minus, Plus } from 'lucide-react';

export function QuantityStepper({
  value,
  min = 1,
  max,
  disabled,
  onChange,
  label = 'Số lượng',
}: {
  value: number;
  min?: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  label?: string;
}) {
  const button =
    'flex size-11 items-center justify-center text-ink transition-colors duration-150 hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <div
      className="inline-flex items-center rounded-sm border border-border bg-surface"
      role="group"
      aria-label={label}
    >
      <button
        type="button"
        className={button}
        onClick={() => onChange(value - 1)}
        disabled={disabled || value <= min}
        aria-label="Giảm số lượng"
      >
        <Minus className="size-4" aria-hidden />
      </button>
      <span className="w-10 text-center font-medium tabular-nums" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className={button}
        onClick={() => onChange(value + 1)}
        disabled={disabled || value >= max}
        aria-label="Tăng số lượng"
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  );
}
