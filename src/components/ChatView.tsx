"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import useResumeStore, {
  type ResumeData,
  type AiResumePayload,
  type InterviewPhase,
  PHASE_TO_STEP,
} from "@/store/useResumeStore";
import { saveGeneratedResume } from "@/app/actions/db";

// ── Word 导出 ─────────────────────────────────────────────────
async function exportChatWord(data: ResumeData) {
  const { Document, Paragraph, TextRun, HeadingLevel, Packer } = await import("docx");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children: any[] = [];
  const h1 = (t: string) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: t, bold: true })] });
  const h2 = (t: string) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: t, bold: true })] });
  const p  = (t: string) => new Paragraph({ children: [new TextRun({ text: t })] });
  const br = () => new Paragraph({ text: "" });

  children.push(h1(data.basics.name || "简历"));
  if (data.targetRole) children.push(p(`目标岗位：${data.targetRole}`));
  const contact = [data.basics.email, data.basics.phone].filter(Boolean).join("  ·  ");
  if (contact) children.push(p(contact));
  if (data.basics.summary) { children.push(br()); children.push(p(data.basics.summary)); }
  children.push(br());

  if (data.education.length > 0) {
    children.push(h2("教育背景"));
    for (const edu of data.education) {
      const period = [edu.startDate, edu.endDate].filter(Boolean).join(" — ");
      children.push(p(`${edu.school}  ${edu.degree} · ${edu.major}${period ? `  （${period}）` : ""}`));
    }
    children.push(br());
  }

  if (data.experience.length > 0) {
    children.push(h2("实践 / 项目经历"));
    for (const exp of data.experience) {
      const title = exp.company ? `${exp.company} — ${exp.role}` : exp.role;
      const period = [exp.startDate, exp.endDate].filter(Boolean).join(" — ");
      children.push(p(`${title}${period ? `  （${period}）` : ""}`));
      if (exp.description) children.push(p(exp.description));
      children.push(br());
    }
  }

  if (data.skills.length > 0) {
    children.push(h2("专业技能"));
    children.push(p(data.skills.join("  ·  ")));
  }

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  const url  = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "resume-chat.docx"; a.click();
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
interface AhaCardData { title: string; content: string; }

// ── 简历序列化（存库用纯文本）────────────────────────────────
function serializeResume(data: ResumeData): string {
  const lines: string[] = [];
  lines.push(data.basics.name || "（姓名待填）");
  if (data.targetRole) lines.push(`目标岗位：${data.targetRole}`);
  const contact = [data.basics.email, data.basics.phone].filter(Boolean).join("  ·  ");
  if (contact) lines.push(contact);
  if (data.basics.summary) { lines.push(""); lines.push(data.basics.summary); }
  if (data.education.length > 0) {
    lines.push("\n【教育背景】");
    for (const e of data.education) {
      lines.push(`${e.school}  ${e.degree} · ${e.major}  ${e.startDate ?? ""}${e.endDate ? ` — ${e.endDate}` : ""}`);
    }
  }
  if (data.experience.length > 0) {
    lines.push("\n【实践 / 项目经历】");
    for (const e of data.experience) {
      lines.push(`${e.company ? `${e.company} — ` : ""}${e.role}  ${e.startDate ?? ""}${e.endDate ? ` — ${e.endDate}` : ""}`);
      if (e.description) lines.push(e.description);
    }
  }
  if (data.skills.length > 0) {
    lines.push("\n【专业技能】");
    lines.push(data.skills.join("  ·  "));
  }
  return lines.join("\n");
}

// ── 正则解析工具 ──────────────────────────────────────────────
const JSON_RE         = /\[\[JSON_START\]\]([\s\S]*?)\[\[JSON_END\]\]/;
const COMMIT_RE       = /\[\[COMMIT_SECTION:([A-Z_]+)\]\]/;
const AHA_CARD_RE     = /<AhaCard>([\s\S]*?)<\/AhaCard>/;
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

function extractAhaCard(raw: string): AhaCardData | null {
  const m = raw.match(AHA_CARD_RE);
  if (!m) return null;
  try {
    const p = JSON.parse(m[1].trim()) as AhaCardData;
    if (typeof p.title === "string" && typeof p.content === "string") return p;
    return null;
  } catch { return null; }
}

function makeId() { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

// ── 进度步骤 ──────────────────────────────────────────────────
const STEPS: { label: string; phase: InterviewPhase }[] = [
  { label: "基本信息", phase: "EDUCATION" },
  { label: "实习经历", phase: "INTERNSHIP" },
  { label: "项目经历", phase: "PROJECT" },
  { label: "荣誉技能", phase: "HONOR" },
  { label: "个人总结", phase: "SUMMARY" },
];

// ── StepTracker ───────────────────────────────────────────────
function StepTracker({ currentPhase }: { currentPhase: InterviewPhase }) {
  const activeStep = PHASE_TO_STEP[currentPhase];
  const allDone = currentPhase === "DONE";

  return (
    <div className="flex items-start gap-0">
      {STEPS.map((s, i) => {
        const done    = allDone || i < activeStep;
        const current = !allDone && i === activeStep;
        return (
          <div key={i} className="flex items-center">
            {i > 0 && (
              <div className={`h-px w-5 transition-all duration-700 ${
                done ? "bg-m-mauve/60" : "bg-m-ink-4/40"
              }`} />
            )}
            <div className="flex flex-col items-center gap-0.5">
              <div className={`flex size-6 items-center justify-center rounded-full text-[9px] font-semibold transition-all duration-500 ${
                done
                  ? "bg-m-mauve text-white shadow-sm"
                  : current
                  ? "border-2 border-m-mauve bg-white text-m-mauve shadow-sm animate-pulse"
                  : "border border-m-ink-4/40 bg-white/60 text-m-ink-4"
              }`}>
                {done ? "✓" : String(i + 1).padStart(2, "0")}
              </div>
              <span className={`text-[8px] whitespace-nowrap font-medium transition-colors duration-300 ${
                current ? "text-m-mauve" : done ? "text-m-ink-3" : "text-m-ink-4"
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

// ── AI 消息气泡 ───────────────────────────────────────────────
function AiBubble({ content }: { content: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-m-mauve/12 text-[10px] font-bold text-m-mauve ring-1 ring-m-mauve/20">
        AI
      </div>
      <div className="max-w-[82%] rounded-2xl rounded-tl-sm border border-black/5 bg-white/80 px-4 py-3 text-sm leading-relaxed text-m-ink shadow-sm backdrop-blur-sm">
        {content ? (
          <div className="prose prose-sm prose-stone max-w-none
            [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5
            [&_strong]:font-semibold [&_strong]:text-m-mauve
            [&_code]:rounded [&_code]:bg-m-mauve/8 [&_code]:px-1 [&_code]:text-m-mauve [&_code]:text-xs">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        ) : (
          <span className="inline-block h-4 w-1 animate-pulse rounded-full bg-m-mauve/60" />
        )}
      </div>
    </div>
  );
}

// ── 用户消息气泡 ──────────────────────────────────────────────
function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex items-start justify-end gap-3">
      <div className="max-w-[82%] whitespace-pre-line rounded-2xl rounded-tr-sm border border-m-mauve/15 bg-m-mauve/10 px-4 py-3 text-sm leading-relaxed text-m-ink">
        {content}
      </div>
    </div>
  );
}

// ── 阶段提交通知 ──────────────────────────────────────────────
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
    <div className="flex items-center gap-2 rounded-xl border border-m-sage/25 bg-m-sage/8 px-3 py-2 text-[10px] font-medium text-m-sage">
      <span>✓</span>
      <span>已提交：{label}</span>
      <span className="ml-auto text-m-ink-3">简历已更新</span>
    </div>
  );
}

// ── AhaCard 奖励卡 ────────────────────────────────────────────
function AhaCardBubble({
  data, onAdopt, adopted,
}: { data: AhaCardData; onAdopt: () => void; adopted: boolean }) {
  return (
    <div className={`relative w-full rounded-2xl border bg-white/85 p-5 backdrop-blur-sm transition-all duration-500 ${
      adopted ? "border-m-mauve/30 opacity-60" : "border-m-mauve/25 aha-card-glow"
    }`}>
      <div className="absolute left-0 top-4 bottom-4 w-0.5 rounded-full bg-gradient-to-b from-transparent via-m-mauve/50 to-transparent" />

      <div className="mb-3 flex items-center gap-2 pl-3">
        <span className="flex size-6 items-center justify-center rounded-full bg-m-mauve/10 ring-1 ring-m-mauve/25 text-sm">
          ✦
        </span>
        <span className="text-[9px] font-semibold uppercase tracking-widest text-m-mauve/80">
          Aha · 高光经历
        </span>
        {adopted && (
          <span className="ml-auto rounded-full border border-m-mauve/25 bg-m-mauve/8 px-2 py-0.5 text-[9px] text-m-mauve">
            ✓ 已加入简历
          </span>
        )}
      </div>

      <p className="mb-2 pl-3 text-sm font-semibold leading-snug text-m-mauve">
        {data.title}
      </p>
      <p className="mb-4 pl-3 text-sm leading-relaxed text-m-ink-2">
        {data.content}
      </p>

      {!adopted && (
        <div className="flex justify-end">
          <button
            onClick={onAdopt}
            className="rounded-xl border border-m-mauve/30 bg-m-mauve/8 px-4 py-1.5 text-[11px] font-medium text-m-mauve transition-all hover:bg-m-mauve/15 hover:shadow-sm"
          >
            + 采纳并加入简历
          </button>
        </div>
      )}
    </div>
  );
}

// ── 简历生成完成横幅 ──────────────────────────────────────────
function ResumeReadyBanner() {
  return (
    <div className="flex items-center justify-center gap-2 rounded-2xl border border-m-sage/25 bg-m-sage/8 px-4 py-3 text-sm font-medium text-m-sage">
      <span>🎉</span>
      简历素材已挖掘完毕，右侧预览已更新，可以导出了
    </div>
  );
}

// ── 简历 Canvas ───────────────────────────────────────────────
function ResumeCanvas({ data }: { data: ResumeData }) {
  const hasBasics     = data.basics.name !== "待填";
  const hasExperience = data.experience.length > 0;
  const hasEducation  = data.education.length > 0;
  const hasSkills     = data.skills.length > 0;
  const hasSummary    = !!data.basics.summary;

  return (
    <div className="resume-paper w-full max-w-[680px] rounded-2xl px-10 py-10">

      {/* 空状态 */}
      {!hasBasics && (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="relative flex size-16 items-center justify-center rounded-full border border-m-mauve/20 bg-m-mauve/5">
            <div className="absolute inset-0 rounded-full border border-m-mauve/10 animate-ping" />
            <span className="text-lg text-m-mauve/30">◈</span>
          </div>
          <div className="text-center">
            <p className="text-xs font-medium tracking-widest text-m-mauve/60 uppercase">
              等待 AI 填充
            </p>
            <p className="mt-1.5 text-[10px] text-m-ink-4">
              与左侧 AI 对话后，简历将在此实时渲染
            </p>
          </div>
        </div>
      )}

      {/* 基本信息 */}
      {hasBasics && (
        <div
          key={`basics-${data.basics.name}`}
          className="section-reveal pb-6 text-center"
          style={{ borderBottom: "1px solid rgba(155,139,160,0.15)" }}
        >
          <p className="text-2xl font-light tracking-wide text-m-ink">
            {data.basics.name}
          </p>
          {data.targetRole && (
            <span className="mt-2 inline-block rounded-full border border-m-mauve/20 bg-m-mauve/8 px-3 py-0.5 text-xs font-medium text-m-mauve">
              {data.targetRole}
            </span>
          )}
          {(data.basics.email || data.basics.phone) && (
            <p className="mt-2 text-xs text-m-ink-3 font-mono">
              {[data.basics.email, data.basics.phone].filter(Boolean).join("  ·  ")}
            </p>
          )}
          {hasSummary && (
            <p key={data.basics.summary} className="section-reveal mx-auto mt-3 max-w-lg text-sm leading-relaxed text-m-ink-2">
              {data.basics.summary}
            </p>
          )}
        </div>
      )}

      {/* 教育背景 */}
      {hasEducation && (
        <section key={`edu-${data.education.length}`} className="section-reveal mt-7">
          <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-m-mauve/70">
            教育背景
          </h3>
          <div className="flex flex-col gap-3 border-l border-m-mauve/12 pl-4">
            {data.education.map((edu, i) => (
              <div key={`${edu.school}-${i}`} className="flex items-baseline justify-between">
                <div>
                  <span className="font-medium text-m-ink">{edu.school}</span>
                  <span className="ml-2 text-sm text-m-ink-3">{edu.degree} · {edu.major}</span>
                </div>
                {(edu.startDate || edu.endDate) && (
                  <span className="text-[11px] font-mono text-m-ink-4">
                    {edu.startDate}{edu.endDate ? ` — ${edu.endDate}` : ""}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 实践 / 项目经历 */}
      {hasExperience && (
        <section key={`exp-${data.experience.length}`} className="section-reveal mt-7">
          <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-m-mauve/70">
            实践 / 项目经历
          </h3>
          <div className="flex flex-col gap-5 border-l border-m-mauve/12 pl-4">
            {data.experience.map((exp, i) => (
              <div key={`${exp.role}-${i}`}>
                <div className="flex items-baseline justify-between">
                  <span className="font-medium text-m-ink">{exp.company ?? exp.role}</span>
                  {(exp.startDate || exp.endDate) && (
                    <span className="text-[11px] font-mono text-m-ink-4">
                      {exp.startDate}{exp.endDate ? ` — ${exp.endDate}` : ""}
                    </span>
                  )}
                </div>
                {exp.company && <p className="text-xs text-m-mauve/80">{exp.role}</p>}
                <p className="mt-1.5 text-sm leading-relaxed text-m-ink-2">{exp.description}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 技能 */}
      {hasSkills && (
        <section key={`skills-${data.skills.join()}`} className="section-reveal mt-7">
          <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-m-mauve/70">
            专业技能
          </h3>
          <div className="flex flex-wrap gap-2">
            {data.skills.map((skill) => (
              <span
                key={skill}
                className="rounded-full border border-m-mauve/18 bg-m-mauve/6 px-3 py-0.5 text-xs text-m-ink-2"
              >
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
  "你好！我是你的 AI 求职教练 👋\n\n先告诉我你的名字，以及你最想申请的方向是什么岗位？";

export default function ChatView() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([
    { id: "welcome", role: "ai", content: WELCOME_TEXT },
  ]);
  const [apiHistory,   setApiHistory]   = useState<ApiMessage[]>([]);
  const [input,        setInput]        = useState("");
  const [isLoading,    setIsLoading]    = useState(false);
  const [wordExporting, setWordExporting] = useState(false);
  const [ahaAdopted,   setAhaAdopted]   = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  const { resumeData, currentPhase, updateBasics, updateResume, advancePhase, appendExperience } =
    useResumeStore();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleExportWord = async () => {
    setWordExporting(true);
    try { await exportChatWord(resumeData); } finally { setWordExporting(false); }
  };

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

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText  = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId ? { ...m, content: extractVisible(fullText) } : m,
          ),
        );
      }

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

      const ahaCard = extractAhaCard(fullText);
      if (ahaCard) {
        const ahaId = makeId();
        setMessages((prev) => [
          ...prev,
          { id: ahaId, role: "ai", content: `__AHACARD__:${JSON.stringify(ahaCard)}` },
        ]);
      }

      if (RESUME_READY_RE.test(fullText)) {
        setMessages((prev) => [
          ...prev,
          { id: makeId(), role: "ai", content: "__RESUME_READY__" },
        ]);
        // 静默入库：拿 zustand 最新快照序列化后存 DB
        const latestData = useResumeStore.getState().resumeData;
        saveGeneratedResume(serializeResume(latestData)).catch(() => {});
      }

      setApiHistory([...nextHistory, { role: "assistant", content: fullText }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      setMessages((prev) =>
        prev.map((m) => m.id === aiMsgId ? { ...m, content: `请求出错：${msg}` } : m),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden">

      {/* ── 顶部 Header ── */}
      <div className="shrink-0 glass-header px-5 py-3 print:hidden">
        <div className="flex items-center gap-3 mb-3">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex items-center gap-1.5 rounded-lg border border-m-ink-4/30 bg-white/50 px-2.5 py-1 text-[10px] font-medium text-m-ink-2 hover:border-m-mauve/40 hover:text-m-mauve transition-colors"
          >
            ← 首页
          </button>
          <span className="text-sm font-medium tracking-wide text-m-ink">
            经历挖掘
            <span className="ml-1.5 text-m-mauve">·</span>
            <span className="ml-1.5 text-m-mauve text-xs font-normal">AI 对话生成</span>
          </span>
          {isLoading && (
            <span className="ml-auto flex items-center gap-1.5 text-[10px] text-m-mauve animate-pulse">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-m-mauve" />
              思考中
            </span>
          )}
          {currentPhase === "DONE" && !isLoading && (
            <span className="ml-auto rounded-full border border-m-sage/25 bg-m-sage/8 px-2.5 py-0.5 text-[10px] font-medium text-m-sage">
              全部完成 ✓
            </span>
          )}
        </div>
        <StepTracker currentPhase={currentPhase} />
      </div>

      {/* ── 主分屏区 ── */}
      <div className="flex-1 flex flex-row min-h-0 overflow-hidden">

        {/* 左侧：对话面板 */}
        <div className="w-1/2 flex flex-col glass-panel border-r border-white/60 print:hidden">

          {/* 消息列表 */}
          <div className="flex-1 overflow-y-auto px-4 py-5">
            <div className="flex flex-col gap-4">
              {messages.map((msg) => {
                if (msg.role === "ai" && msg.content.startsWith("__COMMIT__:")) {
                  return <CommitBanner key={msg.id} phase={msg.content.replace("__COMMIT__:", "") as InterviewPhase} />;
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
              <div ref={bottomRef} />
            </div>
          </div>

          {/* 输入区 */}
          <div className="shrink-0 border-t border-black/5 bg-white/40 px-4 py-3">
            <div className="flex items-center gap-2 rounded-xl border border-black/8 bg-white/75 px-3 py-2 focus-within:border-m-mauve/40 focus-within:shadow-sm transition-all backdrop-blur-sm">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                placeholder={isLoading
                  ? "AI 思考中…"
                  : "输入你的回答，按 Enter 发送…"
                }
                className="flex-1 border-0 bg-transparent py-0.5 text-sm text-m-ink placeholder:text-m-ink-4 focus:ring-0 focus:outline-none"
              />
              <button
                onClick={handleSend}
                disabled={isLoading || !input.trim()}
                className="rounded-lg border border-m-mauve/25 bg-m-mauve/8 px-3 py-1 text-[11px] font-medium text-m-mauve hover:bg-m-mauve/16 disabled:opacity-30 transition-colors"
              >
                发送
              </button>
            </div>
          </div>
        </div>

        {/* 右侧：简历预览 */}
        <div className="flex-1 overflow-y-auto relative print:w-full print:overflow-visible">
          {/* 背景纹理 */}
          <div className="pointer-events-none absolute inset-0 cyber-grid opacity-40" />

          {/* Sticky 标题栏 */}
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-black/5 bg-white/70 px-6 py-2 backdrop-blur-sm print:hidden">
            <span className="text-[10px] font-medium tracking-widest text-m-ink-4 uppercase">
              简历预览
            </span>
            <div className="flex items-center gap-2">
              {resumeData.basics.name !== "待填" && (
                <>
                  <button
                    onClick={() => window.print()}
                    className="flex items-center gap-1.5 rounded-lg border border-black/10 bg-white/60 px-2.5 py-1.5 text-[10px] font-medium text-m-ink-2 hover:border-m-mauve/30 hover:text-m-mauve transition-colors"
                  >
                    导出 PDF
                  </button>
                  <button
                    onClick={handleExportWord}
                    disabled={wordExporting}
                    className="flex items-center gap-1.5 rounded-lg border border-black/10 bg-white/60 px-2.5 py-1.5 text-[10px] font-medium text-m-ink-2 hover:border-m-mauve/30 hover:text-m-mauve transition-colors disabled:opacity-40"
                  >
                    {wordExporting ? "生成中…" : "下载 Word"}
                  </button>
                  <span className="flex items-center gap-1.5 rounded-full border border-m-sage/22 bg-m-sage/7 px-2.5 py-0.5 text-[10px] font-medium text-m-sage">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-m-sage" />
                    实时同步
                  </span>
                </>
              )}
            </div>
          </div>

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
