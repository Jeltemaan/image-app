'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { AlertCircle, Loader2 } from 'lucide-react';
import { signIn, signUp, type AuthState } from '@/app/auth/actions';

const INITIAL: AuthState = { error: null };

type Mode = 'login' | 'signup';

const COPY = {
  login: {
    heading: 'Welcome back',
    sub: 'Sign in to try garments on your own photo.',
    submit: 'Sign in',
    switchText: 'No account yet?',
    switchLabel: 'Create one',
    switchHref: '/signup',
  },
  signup: {
    heading: 'Create your account',
    sub: 'Your name, an email address and a password — that is all.',
    submit: 'Create account',
    switchText: 'Already have an account?',
    switchLabel: 'Sign in',
    switchHref: '/login',
  },
} as const;

const fieldClass =
  'w-full rounded-md border border-hairline px-4 py-3 text-sm outline-none transition placeholder:text-muted focus:border-ink';

export default function AuthForm({ mode }: { mode: Mode }) {
  const copy = COPY[mode];
  const [state, formAction, pending] = useActionState(
    mode === 'signup' ? signUp : signIn,
    INITIAL,
  );

  return (
    <div className="w-full max-w-md">
      <h1 className="text-[30px] font-bold leading-tight tracking-tight sm:text-[34px]">
        {copy.heading}
      </h1>
      <p className="mt-2 text-sm text-muted">{copy.sub}</p>

      <form action={formAction} className="mt-8 space-y-4">
        {mode === 'signup' && (
          <div>
            <label
              htmlFor="fullName"
              className="mb-1.5 block text-xs font-bold tracking-tight"
            >
              Name
            </label>
            <input
              id="fullName"
              name="fullName"
              type="text"
              autoComplete="name"
              required
              maxLength={120}
              placeholder="Your name"
              className={fieldClass}
            />
          </div>
        )}

        <div>
          <label
            htmlFor="email"
            className="mb-1.5 block text-xs font-bold tracking-tight"
          >
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
            className={fieldClass}
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="mb-1.5 block text-xs font-bold tracking-tight"
          >
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={
              mode === 'signup' ? 'new-password' : 'current-password'
            }
            required
            minLength={mode === 'signup' ? 8 : undefined}
            placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'}
            className={fieldClass}
          />
        </div>

        {state.error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md bg-bar px-4 py-3 text-sm"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <span>{state.error}</span>
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-9 py-4 text-sm font-bold text-white transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-25"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {pending ? 'One moment…' : copy.submit}
        </button>
      </form>

      <p className="mt-6 text-sm text-muted">
        {copy.switchText}{' '}
        <Link href={copy.switchHref} className="font-bold text-accent underline">
          {copy.switchLabel}
        </Link>
      </p>
    </div>
  );
}
