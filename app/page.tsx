import TryOnStudio from '@/components/TryOnStudio';
import { AccountMenu } from '@/components/AuthShell';
import { createClient } from '@/lib/supabase/server';

const utilityLinks = [
  'How it works',
  'JPEG, PNG and WEBP — large photos are resized automatically',
  'Best results with a full-body photo',
  'Nothing is stored',
];

const navLinks = [
  { label: 'New', accent: false },
  { label: 'Clothing', accent: false },
  { label: 'Shoes', accent: false },
  { label: 'Streetwear', accent: false },
  { label: 'Accessories', accent: false },
  { label: 'Designer', accent: false },
  { label: 'Sport', accent: false },
  { label: 'Beauty', accent: false },
  { label: 'Brands', accent: false },
  { label: 'Tips', accent: true },
];

const tipColumns = [
  {
    heading: 'Your photo',
    items: [
      'Stand facing the camera',
      'Full body in frame',
      'Plain background',
      'Even, bright light',
    ],
  },
  {
    heading: 'The garment',
    items: [
      'Flat lay or product shot',
      'One item per image',
      'Cut out or white background',
      'No model wearing it',
    ],
  },
  {
    heading: 'File requirements',
    items: ['JPEG or JPG', 'PNG', 'WEBP', 'Large files are resized for you'],
  },
  {
    heading: 'Good to know',
    items: [
      'Generating takes 10 to 30 seconds',
      'Images are not kept after the result',
      'Download before you start over',
      'One garment at a time',
    ],
  },
];

export default async function Home() {
  // The middleware already guarantees a session here; this read is only for the
  // name in the header. getUser, not getSession - it verifies the JWT.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const fullName =
    typeof user?.user_metadata?.full_name === 'string'
      ? user.user_metadata.full_name
      : '';

  return (
    <div className="min-h-screen bg-white">
      {/* Utility bar */}
      <div className="w-full bg-bar">
        <div className="mx-auto flex max-w-7xl gap-6 overflow-x-auto px-4 py-2.5 text-[11px] font-bold tracking-tight text-ink sm:px-6 lg:justify-between no-scrollbar">
          {utilityLinks.map((link) => (
            <span key={link} className="whitespace-nowrap">
              {link}
            </span>
          ))}
        </div>
      </div>

      {/* Header */}
      <header className="border-b border-hairline">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 py-4">
            <nav className="hidden gap-7 text-[15px] font-bold tracking-tight md:flex">
              <span>Women</span>
              <span>Men</span>
              <span>Kids</span>
              <span>Sell</span>
            </nav>
            <div className="md:hidden" />

            {/* Neutral wordmark: orange play triangle + bold lowercase name */}
            <div className="col-start-2 flex items-center justify-center gap-2">
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

            <div className="col-start-3 flex items-center justify-end gap-4">
              <span className="hidden text-xs font-bold underline sm:inline">
                EN
              </span>
              <AccountMenu name={fullName} />
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
                className="hidden sm:block"
              >
                <path d="M12 20s-7.5-4.7-7.5-9.4A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7.5 2.6C19.5 15.3 12 20 12 20Z" />
              </svg>
            </div>
          </div>

          {/* Category nav */}
          <div className="flex items-center justify-between gap-6 pb-3">
            <nav className="flex gap-5 overflow-x-auto text-[14px] tracking-tight no-scrollbar">
              {navLinks.map((link) => (
                <span
                  key={link.label}
                  className={`whitespace-nowrap ${
                    link.accent ? 'text-accent' : 'text-ink'
                  }`}
                >
                  {link.label}
                </span>
              ))}
            </nav>
            <div className="hidden w-72 items-center gap-2 rounded-md border border-ink px-3 py-2.5 lg:flex">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m16.5 16.5 4 4" />
              </svg>
              <span className="text-sm text-muted">Search</span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-20 pt-8 sm:px-6 sm:pt-12">
        <TryOnStudio />
      </main>

      {/* Tips grid, styled after the "more brands" link grid */}
      <footer className="border-t border-hairline">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
          <h2 className="text-[26px] font-bold tracking-tight sm:text-[30px]">
            Tips for the best result
          </h2>
          <div className="mt-8 grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {tipColumns.map((column) => (
              <div key={column.heading}>
                <h3 className="text-sm font-bold tracking-tight">
                  {column.heading}
                </h3>
                <ul className="mt-3 space-y-2">
                  {column.items.map((item) => (
                    <li key={item} className="text-sm text-muted">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
