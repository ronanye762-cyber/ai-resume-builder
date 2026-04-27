import Link from "next/link";
import { createClient } from "@/lib/supabase-server";

function ChatIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      className="size-6">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 10h8M8 14h5" />
    </svg>
  );
}

function MatchIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      className="size-6">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
      <path d="M11 8v6M8 11h6" />
    </svg>
  );
}

function ArrowRight() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className="transition-transform duration-300 group-hover:translate-x-1">
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-20">

      {/* 背景装饰光圈 */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/4 h-96 w-96 rounded-full bg-m-mauve/10 blur-[100px]" />
        <div className="absolute bottom-0 right-1/4 h-80 w-80 rounded-full bg-m-sage/12 blur-[80px]" />
        <div className="absolute top-1/2 left-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-m-slate/8 blur-[120px]" />
      </div>

      {/* ── 顶部 Badge ── */}
      <div className="relative mb-10 inline-flex items-center gap-2 rounded-full glass-pill px-5 py-2">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-m-sage" />
        <span className="text-xs font-medium tracking-[0.2em] text-m-ink-2 uppercase">
          AI · 简历匹配与精修引擎
        </span>
      </div>

      {/* ── Hero 标题区 ── */}
      <div className="relative mb-16 text-center">
        <h1 className="text-5xl font-light tracking-tight text-m-ink sm:text-6xl">
          让经历
          <span className="relative mx-2 font-normal">
            <span className="text-neon-gradient">说话</span>
          </span>
          <br className="sm:hidden" />
          让 AI
          <span className="relative mx-2 font-normal">
            <span className="text-neon-gradient">发光</span>
          </span>
        </h1>
        <p className="mt-6 text-base font-light leading-relaxed text-m-ink-2 sm:text-lg">
          专为求职者设计 · 从零挖掘经历 · 智能匹配 JD · 精准润色简历
        </p>
      </div>

      {/* ── 功能卡片区 ── */}
      <div className="relative flex w-full max-w-2xl flex-col gap-5 sm:flex-row">

        {/* 卡片 A：AI 对话挖掘 */}
        <Link
          href="/chat"
          className="glass-card group flex flex-1 flex-col rounded-3xl p-8 no-underline"
        >
          <div className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-m-mauve/12 text-m-mauve ring-1 ring-m-mauve/20">
            <ChatIcon />
          </div>

          <h2 className="mb-2.5 text-lg font-medium text-m-ink">
            经历挖掘生成
          </h2>
          <p className="flex-1 text-sm leading-relaxed text-m-ink-2">
            没有简历也没关系。AI 扮演资深大厂 HR，通过单轮单问的自然对话，
            逐步挖掘你的校园与实习经历，实时生成专业简历预览。
          </p>

          <div className="mt-7 flex items-center gap-2 text-sm font-medium text-m-mauve">
            开始对话
            <ArrowRight />
          </div>
        </Link>

        {/* 卡片 B：简历匹配润色 */}
        <Link
          href="/match"
          className="glass-card group flex flex-1 flex-col rounded-3xl p-8 no-underline"
        >
          <div className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-m-sage/12 text-m-sage ring-1 ring-m-sage/20">
            <MatchIcon />
          </div>

          <h2 className="mb-2.5 text-lg font-medium text-m-ink">
            简历匹配润色
          </h2>
          <p className="flex-1 text-sm leading-relaxed text-m-ink-2">
            粘贴简历与目标 JD，AI 使用三级加权矩阵精准计算匹配分，
            并输出红绿 Diff 润色建议，一键复制，无缝替换。
          </p>

          <div className="mt-7 flex items-center gap-2 text-sm font-medium text-m-sage">
            开始匹配
            <ArrowRight />
          </div>
        </Link>
      </div>

      {/* ── 特性标签行 ── */}
      <div className="relative mt-12 flex flex-wrap items-center justify-center gap-3">
        {[
          { label: "三级加权矩阵评分", color: "text-m-mauve" },
          { label: "行级 Diff 对比视图", color: "text-m-sage" },
          { label: "OCR 图片识别", color: "text-m-slate" },
          { label: "情绪化分数包装", color: "text-m-rose" },
        ].map((tag) => (
          <span
            key={tag.label}
            className="glass-pill rounded-full px-3 py-1 text-xs text-m-ink-2"
          >
            <span className={`mr-1.5 ${tag.color}`}>·</span>
            {tag.label}
          </span>
        ))}
      </div>

      {/* 登录态入口区 */}
      <div className="relative mt-10 flex items-center gap-3">
        {user ? (
          <>
            <Link
              href="/history"
              className="flex items-center gap-2 rounded-full glass-pill px-5 py-2 text-xs font-medium text-m-ink-2 hover:text-m-mauve transition-colors"
            >
              <span className="text-m-mauve">◈</span>
              我的评估记录
              <span className="text-m-ink-4">→</span>
            </Link>
            <span className="text-[11px] text-m-ink-4 font-mono truncate max-w-[140px]">
              {user.email}
            </span>
          </>
        ) : (
          <Link
            href="/login"
            className="flex items-center gap-2 rounded-full glass-pill px-5 py-2 text-xs font-medium text-m-ink-2 hover:text-m-mauve transition-colors"
          >
            <span className="text-m-mauve">→</span>
            登录 · 保存记录
          </Link>
        )}
      </div>
    </main>
  );
}
