"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[AppError]", error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 px-4 text-center">
      <p className="text-sm font-medium text-m-ink">出了点问题</p>
      <p className="max-w-xs text-xs text-m-ink-3">{error.message}</p>
      <button
        onClick={reset}
        className="rounded-xl border border-m-mauve/30 bg-m-mauve/10 px-4 py-2 text-sm font-medium text-m-mauve hover:bg-m-mauve/18 transition-colors"
      >
        重试
      </button>
    </main>
  );
}
