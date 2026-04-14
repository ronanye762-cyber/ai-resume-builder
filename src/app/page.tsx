import Link from "next/link";

// ── 雷达图标（SVG） ───────────────────────────────────────────
function RadarIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 12 L19.07 4.93" />
      <path d="M12 12 m0 0 a2 2 0 1 0 .01 0" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="11" strokeOpacity="0.3" />
    </svg>
  );
}

// ── 魔棒图标（SVG） ───────────────────────────────────────────
function WandIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z" />
      <path d="m14 7 3 3" />
      <path d="M5 6v4" />
      <path d="M19 14v4" />
      <path d="M10 2v2" />
      <path d="M7 8H3" />
      <path d="M21 16h-4" />
      <path d="M11 3H9" />
    </svg>
  );
}

// ── 首页 ──────────────────────────────────────────────────────
export default function HomePage() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-cyber-bg px-4 py-16">
      {/* 背景网格 */}
      <div className="pointer-events-none absolute inset-0 cyber-grid opacity-60" />

      {/* 背景光晕球 */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 top-1/3 h-[480px] w-[480px] rounded-full bg-neon-purple/8 blur-[120px]" />
        <div className="absolute -right-32 top-1/2 h-[400px] w-[400px] rounded-full bg-neon-cyan/6 blur-[100px]" />
        <div className="absolute bottom-0 left-1/2 h-64 w-96 -translate-x-1/2 rounded-full bg-neon-purple/5 blur-3xl" />
      </div>

      {/* ── 标题区 ── */}
      <div className="relative mb-14 text-center">
        {/* 顶部标签 */}
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-neon-purple/30 bg-neon-purple/10 px-4 py-1.5">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-neon-purple" />
          <span className="text-xs font-medium tracking-widest text-neon-purple/90 uppercase">
            AI · 求职助手
          </span>
        </div>

        <h1 className="text-5xl font-extrabold tracking-tight sm:text-6xl">
          <span className="text-neon-gradient">AI 简历生成器</span>
        </h1>

        <p className="mt-4 text-base text-slate-400">
          让经历说话，让 AI 发光
        </p>
        <p className="mt-1.5 text-sm text-slate-600">
          专为应届生设计 · 从零挖掘 · 智能匹配 · 一键润色
        </p>
      </div>

      {/* ── 功能卡片 ── */}
      <div className="relative flex w-full max-w-3xl flex-col gap-5 sm:flex-row">
        {/* ── 卡片 A：经历挖掘（霓虹紫） ── */}
        <Link
          href="/mining"
          className="card-cyber-purple group flex flex-1 flex-col rounded-2xl p-8 no-underline"
        >
          {/* 图标 */}
          <div className="mb-6 flex size-14 items-center justify-center rounded-xl border border-neon-purple/30 bg-neon-purple/10">
            <RadarIcon className="size-7 text-neon-purple neon-glow-purple" />
          </div>

          {/* 文案 */}
          <h2 className="mb-3 text-xl font-bold text-white">
            个人经历挖掘
          </h2>
          <p className="flex-1 text-sm leading-relaxed text-slate-400">
            AI 职业教练通过温柔对话，逐步挖掘你的校园经历，用 STAR
            法则将口语描述转化为专业简历语言，实时生成简历预览。
          </p>

          {/* CTA */}
          <div className="mt-6 flex items-center gap-2 text-sm font-semibold text-neon-purple transition-gap group-hover:gap-3">
            开始挖掘
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className="transition-transform group-hover:translate-x-1">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </div>
        </Link>

        {/* ── 卡片 B：简历润色（电光青） ── */}
        <Link
          href="/polishing"
          className="card-cyber-cyan group flex flex-1 flex-col rounded-2xl p-8 no-underline"
        >
          {/* 图标 */}
          <div className="mb-6 flex size-14 items-center justify-center rounded-xl border border-neon-cyan/30 bg-neon-cyan/10">
            <WandIcon className="size-7 text-neon-cyan neon-glow-cyan" />
          </div>

          {/* 文案 */}
          <h2 className="mb-3 text-xl font-bold text-white">
            简历优化润色
          </h2>
          <p className="flex-1 text-sm leading-relaxed text-slate-400">
            上传简历（PDF / 图片）或直接粘贴文字，再粘贴目标 JD，AI
            即时评分并给出针对性的优势分析、缺口警告与润色示例。
          </p>

          {/* CTA */}
          <div className="mt-6 flex items-center gap-2 text-sm font-semibold text-neon-cyan transition-gap group-hover:gap-3">
            开始润色
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className="transition-transform group-hover:translate-x-1">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </div>
        </Link>
      </div>

      {/* 底部小字 */}
      <p className="relative mt-12 text-center text-xs text-slate-700">
        数据仅在本地会话中保留，不会上传至任何第三方
      </p>
    </main>
  );
}
