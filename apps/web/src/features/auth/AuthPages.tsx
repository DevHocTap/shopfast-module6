import { FormEvent, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { InputField } from '../../components/ui/Field';
import { Card, InlineAlert } from '../../components/ui/States';
import { ApiError, errorMessage } from '../../lib/api-client';
import { useAuth } from '../../lib/auth';
import type { User } from '../../lib/types';

function homeFor(user: User): string {
  return user.role === 'WAREHOUSE' ? '/warehouse' : '/';
}

function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-sm">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-muted">{subtitle}</p>
      <Card className="mt-8 p-6">{children}</Card>
    </div>
  );
}

export function LoginPage() {
  const { status, user, login } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated' && user) return <Navigate to={from ?? homeFor(user)} replace />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(undefined);
    try {
      const signedIn = await login(String(form.get('email')), String(form.get('password')));
      navigate(from ?? homeFor(signedIn), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title="Đăng nhập" subtitle="Theo dõi đơn hàng và mua sắm nhanh hơn.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <InputField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
        />
        <InputField
          label="Mật khẩu"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <Button type="submit" loading={submitting} className="mt-2 w-full">
          Đăng nhập
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        Chưa có tài khoản?{' '}
        <Link
          to="/register"
          state={{ from }}
          className="font-medium text-brand-700 hover:underline"
        >
          Đăng ký
        </Link>
      </p>
    </AuthCard>
  );
}

export function RegisterPage() {
  const { status, user, register } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated' && user) return <Navigate to={from ?? homeFor(user)} replace />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(undefined);
    setFieldErrors([]);
    try {
      await register(
        String(form.get('fullName')),
        String(form.get('email')),
        String(form.get('password')),
      );
      navigate(from ?? '/', { replace: true });
    } catch (err) {
      // Validation errors come back as a list of field messages.
      if (err instanceof ApiError && Array.isArray(err.details))
        setFieldErrors(err.details as string[]);
      setError(errorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title="Tạo tài khoản" subtitle="Chỉ mất chưa đến một phút.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {error && (
          <InlineAlert tone="danger">
            {fieldErrors.length
              ? fieldErrors.map((message) => <p key={message}>{message}</p>)
              : error}
          </InlineAlert>
        )}
        <InputField label="Họ và tên" name="fullName" autoComplete="name" required autoFocus />
        <InputField label="Email" name="email" type="email" autoComplete="email" required />
        <InputField
          label="Mật khẩu"
          name="password"
          type="password"
          autoComplete="new-password"
          hint="Ít nhất 8 ký tự."
          required
          minLength={8}
        />
        <Button type="submit" loading={submitting} className="mt-2 w-full">
          Tạo tài khoản
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        Đã có tài khoản?{' '}
        <Link to="/login" state={{ from }} className="font-medium text-brand-700 hover:underline">
          Đăng nhập
        </Link>
      </p>
    </AuthCard>
  );
}
