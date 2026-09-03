'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/** Shape returned to the form; `error` is safe to show the user verbatim. */
export type AuthState = { error: string | null };

const MIN_PASSWORD_LENGTH = 8;

function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export async function signUp(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const fullName = readField(formData, 'fullName');
  const email = readField(formData, 'email');
  // Not trimmed: leading and trailing spaces are legitimate password characters.
  const password = String(formData.get('password') ?? '');

  if (!fullName) return { error: 'Please enter your name.' };
  if (!email) return { error: 'Please enter your email address.' };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      error: `Please use a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    // Mirrored into public.profiles by the on_auth_user_created trigger.
    options: { data: { full_name: fullName } },
  });

  if (error) {
    console.error('[auth] sign up failed:', error.message);
    if (error.status === 429) {
      return { error: 'Too many attempts. Please wait a moment and try again.' };
    }
    return {
      error: 'Could not create that account. Check your details and try again.',
    };
  }

  // The account is created but not signed in. That means "Confirm email" is
  // switched on in Supabase Auth, which this app is not set up for - without
  // this branch the user would be redirected to / and bounced straight back to
  // /login with no explanation. Switch it off under
  // Authentication > Sign In / Providers > Email.
  if (!data.session) {
    console.error('[auth] sign up returned no session: is email confirmation on?');
    return {
      error:
        'Your account was created but needs email confirmation before you can sign in. Check your inbox for the confirmation link.',
    };
  }

  revalidatePath('/', 'layout');
  // Straight to the paywall rather than to /, which the middleware would only
  // bounce back here anyway. A new account has no subscription by definition.
  redirect('/billing');
}

export async function signIn(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = readField(formData, 'email');
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { error: 'Please enter your email address and password.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    console.error('[auth] sign in failed:', error.message);
    if (error.status === 429) {
      return { error: 'Too many attempts. Please wait a moment and try again.' };
    }
    // Deliberately does not distinguish "no such account" from "wrong password",
    // so the form cannot be used to discover which addresses are registered.
    return { error: 'Those details do not match an account.' };
  }

  revalidatePath('/', 'layout');
  redirect('/');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}
