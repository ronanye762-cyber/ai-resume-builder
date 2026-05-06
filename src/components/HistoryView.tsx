"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ResultMsg } from "@/app/api/analyze-resume/route";
import { supabase } from "@/lib/supabase";
import { fetchMoreAssessments, fetchMoreResumes } from "@/app/actions/db";

const PAGE_SIZE = 20;

// ── 行类型 ────────────────────────────────────────────────────
interface AssessmentRow {
  id: string;
  job_description: string;
  evaluation_result: ResultMsg;
  created_at: string;
}
interface GeneratedResumeRow {
  id: string;
  final_content: string;
  created_at: string;
}

// ── 工具 ──────────────────────────────────────────────────────
function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("zh-CN", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
function jdSnippet(jd: string) {
  return jd.replace(/\s+/g, " ").slice(0, 60).trim() + (jd.length > 60 ? "…" : "");
}
function scoreColor(s: number) {
  if (s >= 75) return "text-m-sage";
  if (s >= 55) return "text-m-mauve";
  if (s >= 30) return "text-m-slate";
  return "text-m-rose";
}
function scoreBg(s: number) {
  if (s >= 75) return "bg-m-sage/10 border-m-sage/25";
  if (s >= 55) return "bg-m-mauve/8 border-m-mauve/20";
  if (s >= 30) return "bg-m-slate/8 border-m-slate/20";
  return "bg-red-50/60 border-red-400/20";
}

// ── 评估记录卡 ────────────────────────────────────────────────
function AssessmentCard({ row }: { row: AssessmentRow }) {
  const [expanded, setExpanded] = useState(false);
  const score = row.evaluation_result?.total_score ?? row.evaluation_result?.score ?? 0;
  const missing = row.evaluation_result?.missing_skills ?? [];

  return (
    <div className="w-full rounded-2xl border border-black/6 bg-white/72 backdrop-blur-sm overflow-hidden transition-all duration-300">
      {/* 卡头 */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-black/2 transition-colors"
      >
        {/* 分数圆 */}
        <div className={`shrink-0 flex size-12 items-center justify-center rounded-xl border text-base font-light tabular-nums ${scoreBg(score)} ${scoreColor(score)}`}>
          {score}
        </div>

        {/* 主信息 */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-m-ink truncate">
            {jdSnippet(row.job_description)}
          </p>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-mono text-m-ink-4">
              {formatDate(row.created_at)}
            </span>
            {missing.slice(0, 3).map((s) => (
              <span key={s} className="rounded-full border border-red-400/25 bg-red-50/70 px-1.5 py-0.5 text-[9px] font-medium text-red-500">
                缺 {s}
              </span>
            ))}
          </div>
        </div>

        <span className={`shrink-0 text-[10px] font-medium text-m-ink-3 transition-transform duration-300 ${expanded ? "rotate-90" : ""}`}>
          ▶
        </span>
      </button>

      {/* 展开：矩阵详情 */}
      {expanded && (
        <div className="border-t border-black/5 px-5 py-4 bg-black/1.5">
          {/* 权重矩阵 */}
          {row.evaluation_result?.weight_matrix?.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-m-ink-3">
                加权评估矩阵
              </p>
              <div className="flex flex-col gap-1.5">
                {row.evaluation_result.weight_matrix.map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 truncate text-xs text-m-ink" title={item.keyword}>
                      {item.keyword}
                    </span>
                    <div className="flex-1 h-1 rounded-full bg-black/6 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${item.score >= 70 ? "bg-m-sage" : item.score >= 40 ? "bg-m-mauve" : "bg-m-rose/60"}`}
                        style={{ width: `${item.score}%` }}
                      />
                    </div>
                    <span className={`w-8 text-right text-[10px] font-mono shrink-0 ${item.score >= 70 ? "text-m-sage" : item.score >= 40 ? "text-m-mauve" : "text-m-rose"}`}>
                      {item.score}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 润色建议摘要 */}
          {row.evaluation_result?.refine_advice?.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-m-ink-3">
                润色建议（{row.evaluation_result.refine_advice.length} 条）
              </p>
              <div className="flex flex-col gap-2">
                {row.evaluation_result.refine_advice.slice(0, 3).map((item, i) => (
                  <div key={i} className="rounded-xl border border-m-sage/15 bg-m-sage/5 px-3 py-2">
                    <p className="text-[10px] text-m-ink-3 line-through mb-0.5">
                      {item.original_text.slice(0, 60)}{item.original_text.length > 60 ? "…" : ""}
                    </p>
                    <p className="text-xs text-m-sage">
                      {item.polished_text.slice(0, 80)}{item.polished_text.length > 80 ? "…" : ""}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── AI 生成简历卡 ─────────────────────────────────────────────
function ResumeCard({ row }: { row: GeneratedResumeRow }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const preview = row.final_content.replace(/\s+/g, " ").slice(0, 80);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(row.final_content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full rounded-2xl border border-black/6 bg-white/72 backdrop-blur-sm overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-black/2 transition-colors"
      >
        <div className="shrink-0 flex size-12 items-center justify-center rounded-xl border border-m-mauve/20 bg-m-mauve/8 text-m-mauve text-base">
          ◈
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-m-ink truncate">
            {preview}…
          </p>
          <span className="text-[10px] font-mono text-m-ink-4 mt-1 block">
            {formatDate(row.created_at)}
          </span>
        </div>
        <span className={`shrink-0 text-[10px] font-medium text-m-ink-3 transition-transform duration-300 ${expanded ? "rotate-90" : ""}`}>
          ▶
        </span>
      </button>

      {expanded && (
        <div className="border-t border-black/5 px-5 py-4 bg-black/1.5">
          <div className="mb-3 flex justify-end">
            <button
              onClick={handleCopy}
              className={`rounded-lg border px-2.5 py-1 text-[10px] font-medium transition-all ${
                copied
                  ? "border-m-sage/35 bg-m-sage/10 text-m-sage"
                  : "border-black/10 text-m-ink-3 hover:border-m-mauve/30 hover:text-m-mauve"
              }`}
            >
              {copied ? "已复制 ✓" : "一键复制全文"}
            </button>
          </div>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-m-ink-2 max-h-80 overflow-y-auto">
            {row.final_content}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── 空状态 ────────────────────────────────────────────────────
function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl border border-black/6 bg-white/50">
        <span className="text-xl text-m-ink-4">◈</span>
      </div>
      <p className="text-sm text-m-ink-3">{label}</p>
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────
export default function HistoryView({
  assessments: initialAssessments,
  generatedResumes: initialResumes,
  userEmail,
}: {
  assessments: AssessmentRow[];
  generatedResumes: GeneratedResumeRow[];
  userEmail: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"assessments" | "resumes">("assessments");
  const [loggingOut, setLoggingOut] = useState(false);
  const [assessments, setAssessments] = useState(initialAssessments);
  const [resumes, setResumes] = useState(initialResumes);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreA, setHasMoreA] = useState(initialAssessments.length === PAGE_SIZE);
  const [hasMoreR, setHasMoreR] = useState(initialResumes.length === PAGE_SIZE);

  const loadMoreAssessments = async () => {
    setLoadingMore(true);
    const more = await fetchMoreAssessments(assessments.length) as AssessmentRow[];
    setAssessments((prev) => [...prev, ...more]);
    if (more.length < PAGE_SIZE) setHasMoreA(false);
    setLoadingMore(false);
  };

  const loadMoreResumes = async () => {
    setLoadingMore(true);
    const more = await fetchMoreResumes(resumes.length) as GeneratedResumeRow[];
    setResumes((prev) => [...prev, ...more]);
    if (more.length < PAGE_SIZE) setHasMoreR(false);
    setLoadingMore(false);
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  return (
    <main className="relative min-h-screen px-4 py-10">
      {/* 背景光晕 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-24 left-1/4 h-80 w-80 rounded-full bg-m-mauve/8 blur-[90px]" />
        <div className="absolute bottom-10 right-1/4 h-72 w-72 rounded-full bg-m-sage/10 blur-[80px]" />
      </div>

      <div className="relative mx-auto max-w-2xl">

        {/* 顶部导航 */}
        <div className="mb-8 flex items-center gap-3">
          <button
            onClick={() => router.push("/")}
            className="flex items-center gap-1.5 rounded-lg border border-m-ink-4/30 bg-white/50 px-2.5 py-1 text-[10px] font-medium text-m-ink-2 hover:border-m-mauve/40 hover:text-m-mauve transition-colors"
          >
            ← 首页
          </button>
          <span className="text-sm font-medium text-m-ink">
            我的记录
            <span className="ml-1.5 text-m-mauve">·</span>
            <span className="ml-1.5 text-xs font-normal text-m-mauve">历史存档</span>
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden sm:block text-[11px] text-m-ink-4 font-mono truncate max-w-[160px]">
              {userEmail}
            </span>
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="rounded-lg border border-black/10 bg-white/60 px-2.5 py-1 text-[10px] font-medium text-m-ink-3 hover:border-red-400/30 hover:text-red-500 transition-colors"
            >
              {loggingOut ? "退出中…" : "退出登录"}
            </button>
          </div>
        </div>

        {/* Tab 切换 */}
        <div className="mb-6 flex gap-1 rounded-2xl border border-black/6 bg-white/55 backdrop-blur-sm p-1">
          {([
            { key: "assessments", label: "简历诊断记录", count: assessments.length },
            { key: "resumes",     label: "AI 生成简历",  count: resumes.length },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-all duration-200 ${
                tab === t.key
                  ? "bg-white shadow-sm text-m-ink border border-black/6"
                  : "text-m-ink-3 hover:text-m-ink"
              }`}
            >
              {t.label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-mono ${
                tab === t.key ? "bg-m-mauve/10 text-m-mauve" : "bg-black/5 text-m-ink-4"
              }`}>
                {t.count}
              </span>
            </button>
          ))}
        </div>

        {/* 内容区 */}
        <div className="flex flex-col gap-3">
          {tab === "assessments" && (
            assessments.length === 0
              ? <EmptyState label="暂无诊断记录，去 /match 页面做第一次分析吧" />
              : <>
                  {assessments.map((row) => <AssessmentCard key={row.id} row={row} />)}
                  {hasMoreA && (
                    <button
                      onClick={loadMoreAssessments}
                      disabled={loadingMore}
                      className="mt-2 w-full rounded-xl border border-black/8 bg-white/60 py-2.5 text-[12px] font-medium text-m-ink-3 hover:border-m-mauve/30 hover:text-m-mauve transition-colors disabled:opacity-40"
                    >
                      {loadingMore ? "加载中…" : "加载更多"}
                    </button>
                  )}
                </>
          )}
          {tab === "resumes" && (
            resumes.length === 0
              ? <EmptyState label="暂无生成记录，去 /chat 页面开始第一次对话挖掘吧" />
              : <>
                  {resumes.map((row) => <ResumeCard key={row.id} row={row} />)}
                  {hasMoreR && (
                    <button
                      onClick={loadMoreResumes}
                      disabled={loadingMore}
                      className="mt-2 w-full rounded-xl border border-black/8 bg-white/60 py-2.5 text-[12px] font-medium text-m-ink-3 hover:border-m-mauve/30 hover:text-m-mauve transition-colors disabled:opacity-40"
                    >
                      {loadingMore ? "加载中…" : "加载更多"}
                    </button>
                  )}
                </>
          )}
        </div>

      </div>
    </main>
  );
}
