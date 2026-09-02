import { signOut } from '@/app/auth/actions';

/** The orange play triangle + lowercase wordmark, as on the home page. */
export function Wordmark() {
  return (
    <div className="flex items-center gap-2">
      <svg
        width="26"
        height="26"
        viewBox="0 0 26 26"
        aria-hidden="true"
        className="shrink-0"
      >
        <path d="M6 3.5 22 13 6 22.5Z" fill="#ff6900" />
      </svg>
      <span className="text-[26px] font-bold leading-none tracking-tight">
        tryon
      </span>
    </div>
  );
}

/** Centred single-column frame shared by /login and /signup. */
export default function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="border-b border-hairline">
        <div className="mx-auto flex max-w-7xl items-center justify-center px-4 py-4 sm:px-6">
          <Wordmark />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 items-center justify-center px-4 py-14 sm:px-6">
        {children}
      </main>

      <footer className="border-t border-hairline">
        <div className="mx-auto max-w-7xl px-4 py-6 text-xs text-muted sm:px-6">
          Your photos are not stored. They are sent for generation and returned
          as a single image.
        </div>
      </footer>
    </div>
  );
}

/** Name plus a sign-out button, for the signed-in header on the home page. */
export function AccountMenu({ name }: { name: string }) {
  const firstName = name.trim().split(/\s+/)[0] || 'Account';

  return (
    <div className="flex items-center gap-3">
      <span className="hidden text-xs font-bold tracking-tight sm:inline">
        {firstName}
      </span>
      <form action={signOut}>
        <button
          type="submit"
          className="rounded-full border border-hairline px-3 py-1.5 text-xs font-bold transition hover:border-ink"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
