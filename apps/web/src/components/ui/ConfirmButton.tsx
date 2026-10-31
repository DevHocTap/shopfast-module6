import { useState } from 'react';
import { Button, ButtonVariant } from './Button';

/** Two-step button for destructive actions: the first click asks, the second confirms. */
export function ConfirmButton({
  label,
  confirmLabel,
  question,
  variant = 'danger',
  loading,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  question: string;
  variant?: ButtonVariant;
  loading?: boolean;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button variant={variant} onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={question}>
      <span className="text-sm text-muted">{question}</span>
      <Button variant="danger" loading={loading} onClick={onConfirm}>
        {confirmLabel}
      </Button>
      <Button variant="ghost" disabled={loading} onClick={() => setAsking(false)}>
        Không
      </Button>
    </div>
  );
}
