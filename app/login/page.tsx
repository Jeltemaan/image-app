import type { Metadata } from 'next';
import AuthForm from '@/components/AuthForm';
import AuthShell from '@/components/AuthShell';

export const metadata: Metadata = { title: 'Sign in — tryon' };

export default function LoginPage() {
  return (
    <AuthShell>
      <AuthForm mode="login" />
    </AuthShell>
  );
}
