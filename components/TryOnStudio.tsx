'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Download,
  Image as ImageIcon,
  Loader2,
  Sparkles,
} from 'lucide-react';
import UploadTile, { type Selection } from './UploadTile';
import { TARGET_BYTES, formatBytes } from '@/lib/image';

type Status = 'idle' | 'loading' | 'success' | 'error';

const PROGRESS_STEPS = [
  'Reading your photo…',
  'Analysing the garment…',
  'Fitting it to your pose…',
  'Rendering the result…',
  'Almost there…',
];

/** Result types the route can return, mapped to a download extension. */
const RESULT_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Generous ceiling: the webhook itself normally answers in 10-30 seconds. */
const REQUEST_TIMEOUT_MS = 90_000;

export default function TryOnStudio() {
  const [person, setPerson] = useState<Selection | null>(null);
  const [garment, setGarment] = useState<Selection | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultExt, setResultExt] = useState('jpg');
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  // Kept in a ref so the unmount cleanup sees the latest URLs without re-running.
  const urlsRef = useRef<Set<string>>(new Set());

  const track = useCallback((url: string) => {
    urlsRef.current.add(url);
    return url;
  }, []);

  const release = useCallback((url: string | null | undefined) => {
    if (!url) return;
    URL.revokeObjectURL(url);
    urlsRef.current.delete(url);
  }, []);

  // Revoke every object URL this component created when it goes away.
  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      abortRef.current?.abort();
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  // Rotate the progress copy so a 30 second wait does not look frozen.
  useEffect(() => {
    if (status !== 'loading') return;
    setStep(0);
    const id = setInterval(() => {
      setStep((current) => Math.min(current + 1, PROGRESS_STEPS.length - 1));
    }, 5000);
    return () => clearInterval(id);
  }, [status]);

  function selectInto(
    setter: (value: Selection | null) => void,
    current: Selection | null,
    file: File,
  ) {
    release(current?.previewUrl);
    setter({ file, previewUrl: track(URL.createObjectURL(file)) });
    if (status === 'error') {
      setStatus(resultUrl ? 'success' : 'idle');
      setError(null);
    }
  }

  function clearInto(
    setter: (value: Selection | null) => void,
    current: Selection | null,
  ) {
    release(current?.previewUrl);
    setter(null);
  }

  function reset() {
    cancelledRef.current = true;
    abortRef.current?.abort();
    clearInto(setPerson, person);
    clearInto(setGarment, garment);
    release(resultUrl);
    setResultUrl(null);
    setError(null);
    setStatus('idle');
  }

  function cancel() {
    cancelledRef.current = true;
    abortRef.current?.abort();
  }

  const ready = Boolean(person && garment);
  const isLoading = status === 'loading';

  async function generate() {
    if (!person || !garment || isLoading) return;

    const total = person.file.size + garment.file.size;
    if (total > TARGET_BYTES * 2) {
      setStatus('error');
      setError(
        `Those two images come to ${formatBytes(total)} together, over the ${formatBytes(
          TARGET_BYTES * 2,
        )} upload limit. Please use smaller files.`,
      );
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    cancelledRef.current = false;
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    setStatus('loading');
    setError(null);

    try {
      // Do not set Content-Type: the browser must add the multipart boundary itself.
      const body = new FormData();
      body.append('image1', person.file);
      body.append('image2', garment.file);

      const response = await fetch('/api/tryon', {
        method: 'POST',
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(
          detail.trim() || `The request failed (status ${response.status}).`,
        );
      }

      const blob = await response.blob();
      // The route already allowlists the type; this guards against a proxy or
      // service worker substituting something else in between.
      if (!RESULT_EXTENSIONS[blob.type] || blob.size === 0) {
        throw new Error(
          'The webhook did not return an image. Check that the workflow ends with a binary image response.',
        );
      }

      release(resultUrl);
      setResultUrl(track(URL.createObjectURL(blob)));
      setResultExt(RESULT_EXTENSIONS[blob.type]);
      setStatus('success');
    } catch (caught) {
      const aborted =
        caught instanceof DOMException && caught.name === 'AbortError';

      if (aborted && cancelledRef.current) {
        // Deliberate cancel or reset: fall back quietly.
        setStatus((current) => (current === 'loading' ? 'idle' : current));
      } else if (aborted) {
        setStatus('error');
        setError('That took too long and was stopped. Please try again.');
      } else {
        setStatus('error');
        setError(
          caught instanceof Error
            ? caught.message
            : 'Something went wrong. Please try again.',
        );
      }
    } finally {
      clearTimeout(timeout);
      abortRef.current = null;
    }
  }

  return (
    <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[1fr_0.9fr] lg:gap-14">
      {/* Output display - the big rounded hero panel */}
      <section className="order-2 lg:order-1" aria-live="polite">
        <div className="relative flex aspect-4/5 w-full items-center justify-center overflow-hidden rounded-lg bg-bar sm:aspect-7/5 lg:aspect-4/5">
          {status === 'success' && resultUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={resultUrl}
              alt="Generated try-on result"
              className="h-full w-full object-contain"
            />
          ) : isLoading ? (
            <div className="px-8 text-center">
              <Loader2
                size={34}
                className="mx-auto animate-spin text-accent"
                aria-hidden="true"
              />
              <p className="mt-5 text-base font-bold tracking-tight">
                {PROGRESS_STEPS[step]}
              </p>
              <p className="mt-1.5 text-sm text-muted">
                This usually takes 10 to 30 seconds.
              </p>
              <button
                type="button"
                onClick={cancel}
                className="mt-5 text-xs font-bold underline"
              >
                Cancel
              </button>
            </div>
          ) : status === 'error' ? (
            <div className="px-8 text-center">
              <AlertCircle
                size={32}
                className="mx-auto text-red-600"
                aria-hidden="true"
              />
              <p className="mt-4 text-base font-bold tracking-tight text-red-700">
                That did not work
              </p>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
                {error}
              </p>
              <button
                type="button"
                onClick={generate}
                disabled={!ready}
                className="mt-5 rounded-full bg-ink px-6 py-2.5 text-sm font-bold text-white disabled:opacity-40"
              >
                Try again
              </button>
            </div>
          ) : (
            <div className="px-8 text-center">
              <ImageIcon
                size={30}
                className="mx-auto text-muted"
                aria-hidden="true"
              />
              <p className="mt-4 text-sm font-bold tracking-tight text-muted">
                Your result appears here
              </p>
            </div>
          )}
        </div>

        {status === 'success' && resultUrl && (
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href={resultUrl}
              download={`tryon-result.${resultExt}`}
              className="inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-sm font-bold text-white transition hover:opacity-85"
            >
              <Download size={16} aria-hidden="true" />
              Download
            </a>
            <button
              type="button"
              onClick={reset}
              className="rounded-full border border-ink px-6 py-3 text-sm font-bold transition hover:bg-bar"
            >
              Start over
            </button>
          </div>
        )}
      </section>

      {/* Controls */}
      <section className="order-1 lg:order-2 lg:pt-2">
        <h1 className="text-[30px] font-bold leading-[1.15] tracking-tight sm:text-[38px]">
          Let&apos;s get started!
          <br />
          See how it looks on you
        </h1>

        <p className="mt-5 text-sm font-bold tracking-tight">
          Add your photo and the garment
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UploadTile
            label="Your photo"
            hint="Full body, facing the camera"
            value={person}
            disabled={isLoading}
            onSelect={(file) => selectInto(setPerson, person, file)}
            onClear={() => clearInto(setPerson, person)}
          />
          <UploadTile
            label="The garment"
            hint="Product shot or flat lay"
            value={garment}
            disabled={isLoading}
            onSelect={(file) => selectInto(setGarment, garment, file)}
            onClear={() => clearInto(setGarment, garment)}
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={generate}
            disabled={!ready || isLoading}
            className="inline-flex items-center gap-2 rounded-full bg-ink px-9 py-4 text-sm font-bold text-white transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-25"
          >
            {isLoading ? (
              <>
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles size={16} aria-hidden="true" />
                Generate
              </>
            )}
          </button>

          {(person || garment) && !isLoading && (
            <button
              type="button"
              onClick={reset}
              className="rounded-full border border-hairline px-6 py-4 text-sm font-bold transition hover:border-ink"
            >
              Clear
            </button>
          )}
        </div>

        {!ready && !isLoading && (
          <p className="mt-3 text-xs text-muted">
            {!person && !garment
              ? 'Add both images to enable Generate.'
              : !person
                ? 'Still need your photo.'
                : 'Still need the garment.'}
          </p>
        )}
      </section>
    </div>
  );
}
