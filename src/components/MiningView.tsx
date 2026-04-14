"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useResumeStore, {
  type ResumeData,
  type AiResumePayload,
  type InterviewPhase,
  PHASE_TO_STEP,
} from "@/store/useResumeStore";

// ── 挖掘页导出工具 ─────────────────────────────────────────────

async function exportMiningWord(data: ResumeData) {
  const { Document, Paragraph, TextRun, HeadingLevel, Packer } = await import("docx");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children: any[] = [];

  const h1 = (text: string) =>
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text, bold: true })] });
  const h2 = (text: string) =>
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text, bold: true })] });
  const p = (text: string) =>
    new Paragraph({ children: [new TextRun({ text })] });
  const blank = () => new Paragraph({ text: "" });

  // 姓名 & 联系方式
  children.push(h1(data.basics.name || "简历"));
  if (data.targetRole) children.push(p(`目标岗位：${data.targetRole}`));
  const contact = [data.basics.email, data.basics.phone].filter(Boolean).join("  ·  ");
  if (contact) children.push(p(contact));
  if (data.basics.summary) { children.push(blank()); children.push(p(data.basics.summary)); }
  children.push(blank());

  // 教育背景
  if (data.education.length > 0) {
    children.push(h2("教育背景"));
    for (const edu of data.education) {
      const period = [edu.startDate, edu.endDate].filter(Boolean).join(" — ");
      children.push(p(`${edu.school}  ${edu.degree} · ${edu.major}${period ? `  （${period}）` : ""}`));
    }
    children.push(blank());
  }

  // 实践 / 项目经历
  if (data.experience.length > 0) {
    children.push(h2("实践 / 项目经历"));
    for (const exp of data.experience) {
      const title = exp.company ? `${exp.company} — ${exp.role}` : exp.role;
      const period = [exp.startDate, exp.endDate].filter(Boolean).join(" — ");
      children.push(p(`${title}${period ? `  （${period}）` : ""}`));
      if (exp.description) children.push(p(exp.description));
      children.push(blank());
    }
  }

  // 技能
  if (data.skills.length > 0) {
    children.push(h2("专业技能"));
    children.push(p(data.skills.join("  ·  ")));
  }

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mined-resume.docx";
  a.click();
  URL.revokeObjectURL(url);
}

// ── 类型 ──────────────────────────────────────────────────────
interface Message {
  id: string;
  role: "ai" | "user";
  content: string;
}
interface ApiMessage {
  role: "user" | "assistant";
  content: string;
}

// ── 解析工具 ──────────────────────────────────────────────────
const JSON_RE = /\[\[JSON_START\]\]([\s\S]*?)\[\[JSON_END\]\]/;
const COMMIT_RE = /\[\[COMMIT_SECTION:([A-Z_]+)\]\]/;
const AHA_CARD_RE = /<AhaCard>([\s\S]*?)<\/AhaCard>/;
const RESUME_READY_RE = /\[RESUME_READY\]/;

function extractVisible(raw: string): string {
  return raw
    .replace(COMMIT_RE, "")
    .replace(AHA_CARD_RE, "")
    .replace(RESUME_READY_RE, "")
    .replace(JSON_RE, "")
    .trim();
}

function extractPayload(raw: string): AiResumePayload | null {
  const m = raw.match(JSON_RE);
  if (!m) return null;
  try { return JSON.parse(m[1].trim()) as AiResumePayload; } catch { return null; }
}

function extractCommitPhase(raw: string): InterviewPhase | null {
  const m = raw.match(COMMIT_RE);
  return m ? (m[1] as InterviewPhase) : null;
}

interface AhaCardData { title: string; content: string; }

function extractAhaCard(raw: string): AhaCardData | null {
  const m = raw.match(AHA_CARD_RE);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1].trim()) as AhaCardData;
    if (typeof parsed.title === "string" && typeof parsed.content === "string") return parsed;
    return null;
  } catch { return null; }
}

function makeId() { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

// ── 进度条步骤定义 ────────────────────────────────────────────
const STEPS: { label: string; short: string; phase: InterviewPhase }[] = [
  { label: "基本信息", short: "01", phase: "EDUCATION" },
  { label: "实习经历", short: "02", phase: "INTERNSHIP" },
  { label: "项目经历", short: "03", phase: "PROJECT" },
  { label: "荣誉技能", short: "04", phase: "HONOR" },
  { label: "个人总结", short: "05", phase: "SUMMARY" },
];

// ── 5步进度条 ─────────────────────────────────────────────────
function StepTracker({ currentPhase }: { currentPhase: InterviewPhase }) {
  const activeStep = PHASE_TO_STEP[currentPhase]; // 0-5, 5=all done
  const allDone = currentPhase === "DONE";

  return (
    <div className="flex items-start gap-0">
      {STEPS.map((s, i) => {
        const done = allDone || i < activeStep;
        const current = !allDone && i === activeStep;
        return (
          <div key={i} className="flex items-center">
            {i > 0 && (
              <div className={`h-px w-5 transition-all duration-700 ${done ? "bg-neon-purple shadow-[0_0_4px_rgba(191,0,255,0.6)]" : "bg-white/10"}`} />
            )}
            <div className="flex flex-col items-center gap-0.5">
              <div className={`flex size-6 items-center justify-center rounded-full text-[9px] font-bold transition-all duration-500 ${
                done
                  ? "bg-neon-purple text-white shadow-[0_0_8px_rgba(191,0,255,0.8)]"
                  : current
                  ? "border-2 border-neon-purple text-neon-purple shadow-[0_0_12px_rgba(191,0,255,0.5)] animate-pulse"
                  : "border border-white/15 text-white/25"
              }`}>
                {done ? "✓" : s.short}
              </div>
              <span className={`text-[8px] whitespace-nowrap font-mono transition-colors duration-300 ${
                current ? "text-neon-purple font-bold" : done ? "text-white/50" : "text-white/18"
              }`}>
                {s.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── AI 气泡 ───────────────────────────────────────────────────
function AiBubble({ content }: { content: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-neon-purple/40 bg-neon-purple/10 text-[10px] font-bold text-neon-purple"
           style={{ boxShadow: "0 0 8px rgba(191,0,255,0.3)" }}>
        AI
      </div>
      <div className="max-w-[82%] rounded-2xl rounded-tl-sm border border-neon-purple/20 bg-white/4 px-4 py-3 text-sm leading-relaxed text-slate-200"
           style={{ boxShadow: "0 2px 16px rgba(191,0,255,0.06)" }}>
        {content
          ? <span className="whitespace-pre-line">{content}</span>
          : <span className="animate-pulse text-neon-purple">▍</span>
        }
      </div>
    </div>
  );
}

// ── 用户气泡 ──────────────────────────────────────────────────
function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex items-start justify-end gap-3">
      <div className="max-w-[82%] whitespace-pre-line rounded-2xl rounded-tr-sm border border-neon-purple/30 bg-neon-purple/15 px-4 py-3 text-sm leading-relaxed text-white">
        {content}
      </div>
    </div>
  );
}

// ── COMMIT 通知条 ─────────────────────────────────────────────
function CommitBanner({ phase }: { phase: InterviewPhase }) {
  const LABELS: Partial<Record<InterviewPhase, string>> = {
    EDUCATION: "基本信息 & 教育背景",
    INTERNSHIP: "实习经历",
    PROJECT: "项目经历",
    HONOR: "荣誉 & 技能",
    SUMMARY: "个人总结",
  };
  const label = LABELS[phase];
  if (!label) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-neon-purple/30 bg-neon-purple/10 px-3 py-1.5 text-[10px] font-mono text-neon-purple"
         style={{ boxShadow: "0 0 12px rgba(191,0,255,0.15)" }}>
      <span className="animate-pulse">◈</span>
      <span>已提交：{label}</span>
      <span className="ml-auto opacity-60">→ 简历已更新</span>
    </div>
  );
}

// ── AhaCard 奖励卡 ────────────────────────────────────────────
function AhaCardBubble({
  data,
  onAdopt,
  adopted,
}: {
  data: AhaCardData;
  onAdopt: () => void;
  adopted: boolean;
}) {
  return (
    <div
      className={`relative w-full rounded-2xl border bg-black/70 p-5 backdrop-blur-md transition-all duration-500 ${
        adopted
          ? "border-neon-purple/50 opacity-70"
          : "border-neon-purple/35 aha-card-glow"
      }`}
    >
      {/* 左侧竖条装饰 */}
      <div
        className="absolute left-0 top-4 bottom-4 w-0.5 rounded-full"
        style={{ background: "linear-gradient(180deg, transparent, #BF00FF, transparent)" }}
      />

      {/* 头部标签 */}
      <div className="mb-3 flex items-center gap-2 pl-3">
        <span
          className="flex size-6 items-center justify-center rounded-full text-sm"
          style={{
            background: "rgba(191,0,255,0.15)",
            border: "1px solid rgba(191,0,255,0.4)",
            boxShadow: "0 0 10px rgba(191,0,255,0.4)",
          }}
        >
          ✦
        </span>
        <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-neon-purple/80">
          Aha · 高光经历发现
        </span>
        {adopted && (
          <span className="ml-auto rounded-full border border-neon-purple/30 bg-neon-purple/10 px-2 py-0.5 text-[9px] font-mono text-neon-purple">
            ✓ 已加入简历
          </span>
        )}
      </div>

      {/* 标题 */}
      <p
        className="mb-2 pl-3 text-base font-bold leading-snug"
        style={{ color: "#D8B4FE", textShadow: "0 0 12px rgba(191,0,255,0.4)" }}
      >
        {data.title}
      </p>

      {/* 正文 */}
      <p className="mb-4 pl-3 text-sm leading-relaxed text-white/65">
        {data.content}
      </p>

      {/* 采纳按钮 */}
      {!adopted && (
        <div className="flex justify-end pl-3">
          <button
            onClick={onAdopt}
            className="flex items-center gap-1.5 rounded-lg border border-neon-purple/50 bg-neon-purple/15 px-4 py-1.5 text-[11px] font-mono font-bold uppercase tracking-widest text-neon-purple transition-all hover:bg-neon-purple/25 hover:shadow-[0_0_16px_rgba(191,0,255,0.4)]"
          >
            <span>+</span>
            采纳并加入简历
          </button>
        </div>
      )}
    </div>
  );
}

// ── RESUME_READY 完成横幅 ─────────────────────────────────────
function ResumeReadyBanner() {
  return (
    <div
      className="flex items-center justify-center gap-3 rounded-xl border border-neon-purple/40 bg-neon-purple/10 px-4 py-3 text-sm font-mono font-bold text-neon-purple"
      style={{ boxShadow: "0 0 24px rgba(191,0,255,0.2)" }}
    >
      <span className="text-base" style={{ filter: "drop-shadow(0 0 6px rgba(191,0,255,0.8))" }}>🎉</span>
      简历素材已挖掘完毕！右侧简历已更新，可以导出了
    </div>
  );
}

// ── 全息蓝图简历渲染 ──────────────────────────────────────────
function ResumeCanvas({ data }: { data: ReturnType<typeof useResumeStore.getState>["resumeData"] }) {
  const hasBasics = data.basics.name !== "待填";
  const hasExperience = data.experience.length > 0;
  const hasEducation = data.education.length > 0;
  const hasSkills = data.skills.length > 0;
  const hasSummary = !!data.basics.summary;

  return (
    <div className="paper-glow w-full max-w-[720px] rounded-xl px-10 py-10">

      {/* ── 空状态 ── */}
      {!hasBasics && (
        <div className="flex flex-col items-center justify-center py-28 gap-5">
          <div className="relative flex size-24 items-center justify-center">
            <div className="absolute inset-0 rounded-full border border-neon-purple/20 animate-ping" />
            <div className="absolute inset-2 rounded-full border border-neon-purple/15" />
            <span className="text-2xl text-neon-purple/40">◈</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs font-mono tracking-[0.3em] uppercase"
               style={{ color: "rgba(191,0,255,0.75)", textShadow: "0 0 10px rgba(191,0,255,0.5)" }}>
              等待 AI 填充…
            </p>
            <p className="text-[10px] text-white/20 font-mono">
              与左侧 AI 对话后，简历将在此处实时渲染
            </p>
          </div>
          <div className="h-px w-32 bg-gradient-to-r from-transparent via-neon-purple/40 to-transparent" />
        </div>
      )}

      {/* ── 基本信息 ── */}
      {hasBasics && (
        <div key={`basics-${data.basics.name}`}
          className="section-reveal pb-6 text-center"
          style={{ borderBottom: "1px solid rgba(191,0,255,0.18)" }}>
          <p className="text-2xl font-bold tracking-wide text-white"
             style={{ textShadow: "0 0 20px rgba(191,0,255,0.4)" }}>
            {data.basics.name}
          </p>
          {data.targetRole && (
            <span className="mt-2 inline-block rounded-full border border-neon-purple/40 bg-neon-purple/10 px-3 py-0.5 text-xs font-medium text-neon-purple"
                  style={{ boxShadow: "0 0 8px rgba(191,0,255,0.2)" }}>
              目标岗位：{data.targetRole}
            </span>
          )}
          {(data.basics.email || data.basics.phone) && (
            <p className="mt-2 text-xs text-white/40 font-mono">
              {[data.basics.email, data.basics.phone].filter(Boolean).join("  ·  ")}
            </p>
          )}
          {hasSummary && (
            <p key={data.basics.summary}
               className="section-reveal mx-auto mt-3 max-w-lg text-sm leading-relaxed text-white/65">
              {data.basics.summary}
            </p>
          )}
        </div>
      )}

      {/* ── 教育背景 ── */}
      {hasEducation && (
        <section key={`edu-${data.education.length}`} className="section-reveal mt-7">
          <h3 className="mb-3 text-[10px] font-mono font-bold uppercase tracking-[0.25em]"
              style={{ color: "rgba(191,0,255,0.8)", textShadow: "0 0 8px rgba(191,0,255,0.4)" }}>
            ◈ 教育背景
          </h3>
          <div className="flex flex-col gap-3"
               style={{ borderLeft: "1px solid rgba(191,0,255,0.15)", paddingLeft: "1rem" }}>
            {data.education.map((edu, i) => (
              <div key={`${edu.school}-${i}`} className="flex items-baseline justify-between">
                <div>
                  <span className="font-semibold text-white/90">{edu.school}</span>
                  <span className="ml-2 text-sm text-white/45">{edu.degree} · {edu.major}</span>
                </div>
                {(edu.startDate || edu.endDate) && (
                  <span className="text-[11px] font-mono text-white/30">
                    {edu.startDate}{edu.endDate ? ` — ${edu.endDate}` : ""}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── 实习 / 项目经历 ── */}
      {hasExperience && (
        <section key={`exp-${data.experience.length}`} className="section-reveal mt-7">
          <h3 className="mb-3 text-[10px] font-mono font-bold uppercase tracking-[0.25em]"
              style={{ color: "rgba(191,0,255,0.8)", textShadow: "0 0 8px rgba(191,0,255,0.4)" }}>
            ◈ 实践 / 项目经历
          </h3>
          <div className="flex flex-col gap-5"
               style={{ borderLeft: "1px solid rgba(191,0,255,0.15)", paddingLeft: "1rem" }}>
            {data.experience.map((exp, i) => (
              <div key={`${exp.role}-${i}`}>
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold text-white/90">{exp.company ?? exp.role}</span>
                  {(exp.startDate || exp.endDate) && (
                    <span className="text-[11px] font-mono text-white/30">
                      {exp.startDate}{exp.endDate ? ` — ${exp.endDate}` : ""}
                    </span>
                  )}
                </div>
                {exp.company && <p className="text-xs text-neon-purple/70">{exp.role}</p>}
                <p className="mt-1 text-sm leading-relaxed text-white/60">{exp.description}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── 技能 ── */}
      {hasSkills && (
        <section key={`skills-${data.skills.join()}`} className="section-reveal mt-7">
          <h3 className="mb-3 text-[10px] font-mono font-bold uppercase tracking-[0.25em]"
              style={{ color: "rgba(191,0,255,0.8)", textShadow: "0 0 8px rgba(191,0,255,0.4)" }}>
            ◈ 专业技能
          </h3>
          <div className="flex flex-wrap gap-2">
            {data.skills.map((skill) => (
              <span key={skill}
                className="rounded-full border border-neon-purple/30 bg-neon-purple/8 px-3 py-0.5 text-xs text-neon-purple/80"
                style={{ boxShadow: "0 0 6px rgba(191,0,255,0.1)" }}>
                {skill}
              </span>
            ))}
          </div>
        </section>
      )}

    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────
const WELCOME_TEXT =
  "你好！我是你的 AI 职业规划教练 👋\n先告诉我你的名字，以及你最想申请的方向是什么岗位？";

export default function MiningView() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([
    { id: "welcome", role: "ai", content: WELCOME_TEXT },
  ]);
  const [apiHistory, setApiHistory] = useState<ApiMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [wordExporting, setWordExporting] = useState(false);
  const [ahaAdopted, setAhaAdopted] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  const handleExportMiningWord = async () => {
    setWordExporting(true);
    try { await exportMiningWord(resumeData); } finally { setWordExporting(false); }
  };

  const { resumeData, currentPhase, updateBasics, updateResume, advancePhase, appendExperience } =
    useResumeStore();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsgId = makeId();
    setMessages((prev) => [...prev, { id: userMsgId, role: "user", content: text }]);
    setInput("");

    const nextHistory: ApiMessage[] = [...apiHistory, { role: "user", content: text }];
    const aiMsgId = makeId();
    setMessages((prev) => [...prev, { id: aiMsgId, role: "ai", content: "" }]);
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextHistory, currentPhase }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        // 实时更新气泡（隐藏标记符）
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId ? { ...m, content: extractVisible(fullText) } : m
          )
        );
      }

      // ── 流结束后：解析 payload & commit ──────────────────────
      const payload = extractPayload(fullText);
      if (payload) {
        updateResume(payload);
        if (payload.basics?.name) updateBasics({ name: payload.basics.name });
      }

      const commitPhase = extractCommitPhase(fullText);
      if (commitPhase) {
        advancePhase();
        setMessages((prev) => [
          ...prev,
          { id: makeId(), role: "ai", content: `__COMMIT__:${commitPhase}` },
        ]);
      }

      // ── AhaCard 检测：插入奖励卡消息 ─────────────────────────
      const ahaCard = extractAhaCard(fullText);
      if (ahaCard) {
        const ahaId = makeId();
        setMessages((prev) => [
          ...prev,
          { id: ahaId, role: "ai", content: `__AHACARD__:${JSON.stringify(ahaCard)}` },
        ]);
      }

      // ── RESUME_READY 检测 ─────────────────────────────────────
      if (RESUME_READY_RE.test(fullText)) {
        setMessages((prev) => [
          ...prev,
          { id: makeId(), role: "ai", content: "__RESUME_READY__" },
        ]);
      }

      setApiHistory([...nextHistory, { role: "assistant", content: fullText }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMsgId ? { ...m, content: `⚠️ 请求出错：${msg}` } : m
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    /*
     * ┌─────────────────────────────────────────────────────────┐
     * │  Root: full-viewport column, NO global scroll          │
     * └─────────────────────────────────────────────────────────┘
     */
    <div className="h-screen w-full flex flex-col overflow-hidden bg-cyber-bg">

      {/* ══ 1. 顶部全宽 Header（shrink-0，永不被挤压）════════════ */}
      <div className="shrink-0 header-cyber px-5 py-3 print:hidden">
        {/* 导航行 */}
        <div className="flex items-center gap-3 mb-3">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex items-center gap-1 rounded-md border border-neon-purple/20 px-2 py-1 text-[10px] font-mono text-neon-purple/70 hover:border-neon-purple/60 hover:text-neon-purple transition-colors cursor-pointer"
          >
            ← HOME
          </button>
          <span className="text-sm font-bold tracking-widest text-white/90 uppercase">
            经历 <span className="text-neon-purple">挖掘</span>
          </span>
          {isLoading && (
            <span className="ml-auto flex items-center gap-1.5 text-[10px] font-mono text-neon-purple animate-pulse">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-neon-purple" />
              THINKING
            </span>
          )}
          {currentPhase === "DONE" && !isLoading && (
            <span
              className="ml-auto rounded-full border border-neon-purple/40 px-2 py-0.5 text-[10px] font-mono text-neon-purple"
              style={{ boxShadow: "0 0 8px rgba(191,0,255,0.3)" }}
            >
              ALL DONE ✓
            </span>
          )}
        </div>
        {/* 5步进度条（固定在顶部，不随内容滚动） */}
        <StepTracker currentPhase={currentPhase} />
      </div>

      {/*
       * ══ 2. 主分屏区（flex-1 + min-h-0 = 填满剩余高度且不溢出）
       *    min-h-0 是关键：阻止 flex 子元素撑破父容器
       */}
      <div className="flex-1 flex flex-row min-h-0 overflow-hidden">

        {/* ── 左侧：对话面板 (50%) ──────────────────────────── */}
        <div className="w-1/2 flex flex-col panel-cyber-purple border-r border-neon-purple/15 print:hidden">

          {/* 消息列表：flex-1 + overflow-y-auto → 独立滚动 */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="flex flex-col gap-4">
              {messages.map((msg) => {
                if (msg.role === "ai" && msg.content.startsWith("__COMMIT__:")) {
                  const phase = msg.content.replace("__COMMIT__:", "") as InterviewPhase;
                  return <CommitBanner key={msg.id} phase={phase} />;
                }
                if (msg.role === "ai" && msg.content === "__RESUME_READY__") {
                  return <ResumeReadyBanner key={msg.id} />;
                }
                if (msg.role === "ai" && msg.content.startsWith("__AHACARD__:")) {
                  let cardData: AhaCardData | null = null;
                  try { cardData = JSON.parse(msg.content.slice("__AHACARD__:".length)) as AhaCardData; } catch { /* ignore */ }
                  if (!cardData) return null;
                  return (
                    <AhaCardBubble
                      key={msg.id}
                      data={cardData}
                      adopted={ahaAdopted.has(msg.id)}
                      onAdopt={() => {
                        appendExperience({ role: cardData!.title, description: cardData!.content });
                        setAhaAdopted((prev) => new Set(prev).add(msg.id));
                      }}
                    />
                  );
                }
                return msg.role === "ai"
                  ? <AiBubble key={msg.id} content={msg.content} />
                  : <UserBubble key={msg.id} content={msg.content} />;
              })}
              {/* 自动滚动锚点 */}
              <div ref={bottomRef} />
            </div>
          </div>

          {/* 输入区：shrink-0，钉在左侧底部 */}
          <div className="shrink-0 border-t border-neon-purple/10 bg-black/30 px-4 py-3">
            <div className="flex items-center gap-2 rounded-lg border border-neon-purple/25 bg-black/50 px-3 py-2 focus-within:border-neon-purple/60 focus-within:shadow-[0_0_12px_rgba(191,0,255,0.15)] transition-all">
              <span className="font-mono text-sm text-green-400 select-none">›</span>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                placeholder={isLoading ? "AI 思考中…" : "输入消息，按 Enter 发送"}
                className="terminal-input flex-1 border-0 bg-transparent py-0 text-sm focus:ring-0 focus:outline-none"
              />
              <button
                onClick={handleSend}
                disabled={isLoading || !input.trim()}
                className="rounded px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-widest text-neon-purple border border-neon-purple/30 hover:bg-neon-purple/10 disabled:opacity-30 transition-colors"
              >
                SEND
              </button>
            </div>
          </div>
        </div>

        {/* ── 右侧：全息简历预览 (50%) ─────────────────────── */}
        <div className="flex-1 overflow-y-auto bg-cyber-bg relative print:w-full print:overflow-visible print:bg-white">
          {/* 背景装饰（pointer-events-none，不影响滚动） */}
          <div className="pointer-events-none fixed top-0 right-0 w-1/2 h-full cyber-grid opacity-25 z-0" />
          <div className="pointer-events-none fixed top-0 right-0 w-1/2 flex justify-center z-0">
            <div className="h-40 w-80 rounded-full bg-neon-purple/5 blur-3xl" />
          </div>

          {/* 悬浮标题（sticky 吸顶） */}
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/5 bg-cyber-bg/80 px-6 py-2 backdrop-blur-sm print:hidden">
            <span className="text-[10px] font-mono tracking-widest text-white/25 uppercase">
              resume · hologram
            </span>
            <div className="flex items-center gap-2">
              {resumeData.basics.name !== "待填" && (
                <>
                  {/* 导出 PDF */}
                  <button
                    onClick={() => window.print()}
                    title="导出 PDF（仅简历内容）"
                    className="flex items-center gap-1.5 rounded-md border border-neon-purple/25 px-2.5 py-1.5 text-[10px] font-mono text-neon-purple/60 transition-colors hover:border-neon-purple/60 hover:bg-neon-purple/10 hover:text-neon-purple"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24"
                      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 6 2 18 2 18 9" />
                      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                      <rect x="6" y="14" width="12" height="8" />
                    </svg>
                    导出 PDF
                  </button>
                  {/* 下载 Word */}
                  <button
                    onClick={handleExportMiningWord}
                    disabled={wordExporting}
                    title="下载 Word (.docx)"
                    className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[10px] font-mono transition-colors ${
                      wordExporting
                        ? "cursor-wait border-white/10 text-white/20"
                        : "border-neon-purple/30 text-neon-purple/70 hover:border-neon-purple/60 hover:bg-neon-purple/10 hover:text-neon-purple"
                    }`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24"
                      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="12" y1="12" x2="12" y2="18" />
                      <polyline points="9 15 12 18 15 15" />
                    </svg>
                    {wordExporting ? "生成中…" : "下载 Word"}
                  </button>
                </>
              )}
              {resumeData.basics.name !== "待填" && (
                <span className="flex items-center gap-1.5 rounded-full border border-neon-purple/30 px-2.5 py-0.5 text-[10px] font-mono text-neon-purple">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-neon-purple" />
                  LIVE
                </span>
              )}
            </div>
          </div>

          {/* A4 画布（随右侧面板独立滚动） */}
          <div className="relative z-10 px-6 py-8">
            <div className="flex justify-center">
              <ResumeCanvas data={resumeData} />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
