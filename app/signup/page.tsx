import type { Metadata } from 'next';
import AuthForm from '@/components/AuthForm';
import AuthShell from '@/components/AuthShell';

export const metadata: Metadata = { title: 'Create an account — tryon' };

export default function SignupPage() {
  return (
    <AuthShell>
      <AuthForm mode="signup" />
    </AuthShell>
  );
}
