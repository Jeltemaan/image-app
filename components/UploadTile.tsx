'use client';

import { useId, useRef, useState } from 'react';
import { AlertCircle, ImagePlus, Loader2, RefreshCw, X } from 'lucide-react';
import { formatBytes, shrinkIfNeeded, validateImage } from '@/lib/image';

export type Selection = { file: File; previewUrl: string };

type Props = {
  label: string;
  hint: string;
  value: Selection | null;
  disabled?: boolean;
  onSelect: (file: File) => void;
  onClear: () => void;
};

export default function UploadTile({
  label,
  hint,
  value,
  disabled = false,
  onSelect,
  onClear,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  const busy = disabled || isPreparing;

  async function accept(file: File | undefined) {
    if (!file) return;

    const message = validateImage(file);
    if (message) {
      setError(message);
      return;
    }

    setError(null);
    setIsPreparing(true);
    try {
      // Large phone photos are downscaled here rather than refused.
      const prepared = await shrinkIfNeeded(file);
      onSelect(prepared);
    } catch {
      setError('That image could not be read. Please try another one.');
    } finally {
      setIsPreparing(false);
    }
  }

  function openPicker() {
    if (!busy) inputRef.current?.click();
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={busy ? -1 : 0}
        aria-label={`${label}. ${hint}`}
        aria-describedby={error ? errorId : undefined}
        aria-disabled={busy}
        onClick={openPicker}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openPicker();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          if (!busy) void accept(event.dataTransfer.files?.[0]);
        }}
        className={`group relative flex aspect-4/5 w-full flex-col items-center justify-center overflow-hidden rounded-lg border-2 text-center transition-colors ${
          isDragging
            ? 'border-dashed border-accent bg-accent/5'
            : error
              ? 'border-solid border-red-500'
              : value
                ? 'border-solid border-ink'
                : 'border-dashed border-hairline hover:border-ink'
        } ${busy ? 'cursor-wait opacity-60' : 'cursor-pointer'}`}
      >
        {isPreparing ? (
          <div className="px-5">
            <Loader2
              size={24}
              className="mx-auto animate-spin text-accent"
              aria-hidden="true"
            />
            <p className="mt-3 text-xs font-bold tracking-tight">Preparing…</p>
          </div>
        ) : value ? (
          <>
            {/* Object URL of a local file, so next/image would add no value here. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={value.previewUrl}
              alt={`${label} preview`}
              className="h-full w-full object-cover"
            />
            {!disabled && (
              // pointer-events-none while invisible so it cannot swallow clicks.
              <div className="pointer-events-none absolute inset-0 flex items-end justify-center gap-2 p-3 opacity-0 transition group-hover:pointer-events-auto group-hover:bg-black/35 group-hover:opacity-100 focus-within:pointer-events-auto focus-within:bg-black/35 focus-within:opacity-100">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold">
                  <RefreshCw size={13} aria-hidden="true" />
                  Replace
                </span>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setError(null);
                    onClear();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-xs font-bold text-white"
                >
                  <X size={13} aria-hidden="true" />
                  Remove
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="px-5">
            <ImagePlus
              size={26}
              className="mx-auto text-muted"
              aria-hidden="true"
            />
            <p className="mt-3 text-sm font-bold tracking-tight">{label}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">{hint}</p>
            <p className="mt-3 text-xs font-bold underline">Choose a file</p>
          </div>
        )}
      </div>

      {/*
        Deliberately a sibling of the clickable area, not a child: input.click()
        dispatches a bubbling click event, and from inside it would re-trigger the
        wrapper's onClick and recurse.
      */}
      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        className="hidden"
        disabled={busy}
        onChange={(event) => {
          void accept(event.target.files?.[0]);
          // Reset so picking the same file twice still fires onChange.
          event.target.value = '';
        }}
      />

      {error ? (
        <p
          id={errorId}
          role="alert"
          className="mt-2 flex items-start gap-1.5 text-xs font-bold text-red-600"
        >
          <AlertCircle size={14} className="mt-px shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : value ? (
        <p className="mt-2 truncate text-xs text-muted">
          {value.file.name} · {formatBytes(value.file.size)}
        </p>
      ) : null}
    </div>
  );
}
