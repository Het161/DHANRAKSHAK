"use client";

import { useRef } from "react";

import { usePreferences } from "@/i18n/I18nProvider";

export function ScreenshotInput({
  file,
  onChange,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  const { t } = usePreferences();
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-2xl border border-dashed border-line-strong bg-surface p-5 text-center">
      <p className="mb-4 text-base text-ink-soft">{t("analyzer.screenshotPrompt")}</p>

      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          className="focus-ring rounded-2xl border border-line-strong bg-paper px-4 py-3 font-semibold text-ink"
        >
          {t("analyzer.screenshotCamera")}
        </button>
        <button
          type="button"
          onClick={() => galleryRef.current?.click()}
          className="focus-ring rounded-2xl border border-line-strong bg-paper px-4 py-3 font-semibold text-ink"
        >
          {t("analyzer.screenshotChoose")}
        </button>
      </div>

      {file && (
        <p className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm text-ink-soft">
          <span className="max-w-full truncate">{t("analyzer.selectedFile", { name: file.name })}</span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="focus-ring rounded-lg px-2 py-1 font-semibold text-scam"
          >
            {t("analyzer.removeFile")}
          </button>
        </p>
      )}
    </div>
  );
}
