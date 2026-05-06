"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError]", error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body className="flex min-h-screen flex-col items-center justify-center gap-5 px-4 text-center">
        <p className="text-sm font-medium">出了点问题</p>
        <p className="max-w-xs text-xs text-gray-500">{error.message}</p>
        <button
          onClick={reset}
          className="rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50 transition-colors"
        >
          重试
        </button>
      </body>
    </html>
  );
}
