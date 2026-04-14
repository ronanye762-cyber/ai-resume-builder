"use client";

import useResumeStore from "@/store/useResumeStore";

export default function IdleView() {
  const { setMode } = useResumeStore();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50 px-4">
      {/* 标题区 */}
      <div className="mb-12 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-slate-800">
          AI 求职助手
        </h1>
        <p className="mt-3 text-slate-500">
          为应届生量身定制，让你的求职之路更顺畅
        </p>
      </div>

      {/* 功能卡片 */}
      <div className="flex w-full max-w-3xl flex-col gap-5 sm:flex-row">
        {/* Card A — 经历挖掘 */}
        <button
          onClick={() => setMode("mining")}
          className="group flex flex-1 flex-col items-start gap-4 rounded-2xl border border-slate-200 bg-white p-8 text-left shadow-sm transition-all hover:-translate-y-1 hover:border-indigo-300 hover:shadow-md"
        >
          <div className="flex size-14 items-center justify-center rounded-xl bg-indigo-50 text-3xl transition-transform group-hover:scale-110">
            🎯
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-800">
              从零开始挖掘经历
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
              AI 教练通过对话逐步挖掘你的校园经历，用 STAR
              法则帮你将口语转化为专业简历语言，实时生成简历预览。
            </p>
          </div>
          <span className="mt-auto text-xs font-medium text-indigo-500 group-hover:underline">
            开始挖掘 →
          </span>
        </button>

        {/* Card B — 简历润色 */}
        <button
          onClick={() => setMode("polishing")}
          className="group flex flex-1 flex-col items-start gap-4 rounded-2xl border border-slate-200 bg-white p-8 text-left shadow-sm transition-all hover:-translate-y-1 hover:border-violet-300 hover:shadow-md"
        >
          <div className="flex size-14 items-center justify-center rounded-xl bg-violet-50 text-3xl transition-transform group-hover:scale-110">
            ✨
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-800">
              简历匹配与润色
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
              上传你的简历（PDF / 图片），粘贴目标岗位 JD，AI
              即时评分并给出针对性的优化建议。
            </p>
          </div>
          <span className="mt-auto text-xs font-medium text-violet-500 group-hover:underline">
            开始润色 →
          </span>
        </button>
      </div>

      <p className="mt-10 text-xs text-slate-400">
        数据仅用于生成简历，不会上传至任何第三方
      </p>
    </div>
  );
}
