'use client';

import { useRef, useState } from 'react';

/**
 * A photo for a piece of proof. On a phone it opens the camera. The picture is shrunk in the
 * browser (longest side 1600 px, JPEG) before it is sent, because field signal is often weak;
 * the server still checks the type and size itself and computes the hash from what arrives.
 * If the browser cannot shrink it, the original is sent as it is.
 */
export function PhotoInput({ name = 'photo', label, hint, changeLabel, buttonLabel }: {
  name?: string; label: string; hint: string; changeLabel: string;
  /** The button's own words; the browser's "Choose file" cannot be translated. */
  buttonLabel: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ url: string; kb: number } | null>(null);

  async function shrink(file: File): Promise<File> {
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      if (scale === 1 && file.type === 'image/jpeg' && file.size < 900_000) return file;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
      return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
    } catch {
      return file;
    }
  }

  async function onChange() {
    const input = ref.current;
    const file = input?.files?.[0];
    if (!input || !file) { setPreview(null); return; }
    const small = await shrink(file);
    if (small !== file) {
      const dt = new DataTransfer();
      dt.items.add(small);
      input.files = dt.files;
    }
    setPreview({ url: URL.createObjectURL(small), kb: Math.round(small.size / 1024) });
  }

  return (
    <div className="mb-3">
      <label className="block">
        <span className="label">{label}</span>
        <input
          ref={ref} type="file" name={name} accept="image/jpeg,image/png,image/webp" capture="environment"
          onChange={onChange} className="peer sr-only"
        />
        <span className="mt-1 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-brand/30 bg-brand-light px-4 text-md font-medium text-brand peer-focus-visible:ring-4 peer-focus-visible:ring-brand/25">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" /></svg>
          {buttonLabel}
        </span>
      </label>
      {preview ? (
        <div className="mt-2 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local preview, never optimised */}
          <img src={preview.url} alt="" className="h-20 w-20 rounded-md border border-line object-cover" />
          <span className="text-xs text-ink-faint">{preview.kb} KB · {changeLabel}</span>
        </div>
      ) : <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}
