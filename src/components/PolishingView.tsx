"use client";

import { useRef, useState } from "react";

// ── OCR 后处理拦截器（防弹级三步兜底，无论大模型返回什么垃圾格式都不崩溃）──
function sanitizeOcrText(raw: string): { text: string; isValid: boolean } {
  // 终极推土机：把 "text": 之后的所有内容暴力截出，再无差别清洗 JSON 控制符
  function bulldozerExtract(str: string): string {
    const m = str.match(/"text"\s*:\s*([\s\S]*)/);
    if (!m) return '';
    return m[1]
      .replace(/[{}\[\]"\\]/g, '')  // 去掉 {} [] " \
      .replace(/\\n/g, '\n')         // 保留换行语义
      .trim();
  }

  // Step A：剥离 markdown 代码围栏
  const stripped = raw
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  // 提前拦截无效图片（兜住后续解析失败时也能正确判定）
  if (/["']?is_valid["']?\s*:\s*false/.test(stripped)) {
    return { text: '', isValid: false };
  }

  // Step B：尝试标准 JSON.parse
  const jsonMatch = stripped.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { is_valid?: boolean; text?: string };
      if (parsed.is_valid === false) return { text: '', isValid: false };
      const textVal = (parsed.text ?? '').trim();
      if (textVal) return { text: textVal, isValid: true };
      return { text: '', isValid: false };
    } catch {
      // Step C：JSON 格式畸形 → 启动终极推土机
      console.warn('[sanitizeOcrText] JSON 解析失败，启动正则回退机制:', stripped.slice(0, 200));
      const extracted = bulldozerExtract(stripped);
      if (extracted.length > 5) return { text: extracted, isValid: true };
    }
  }

  // 安全红线：结果仍含 JSON 结构特征则拦截，绝不透传给 UI
  if (/^\s*\{/.test(stripped) || /"(is_valid|text|error_code)"/.test(stripped)) {
    console.warn('[sanitizeOcrText] 安全红线触发，拦截 JSON 结构泄漏');
    return { text: '', isValid: false };
  }

  const plain = stripped;
  return { text: plain, isValid: plain.length > 5 };
}
import { useRouter } from "next/navigation";
import type { PipelineMsg, ResultMsg, PolishedItem } from "@/app/api/analyze-resume/route";
import type { TranslatedJd } from "@/app/api/translate-jd/route";
import type { SelfIntroData } from "@/app/api/self-intro/route";

// ─────────────────────────────────────────────────────────────
// HybridInput：TextArea 卡片 + 文件上传
// ─────────────────────────────────────────────────────────────
interface HybridInputProps {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  onExtractingChange?: (v: boolean) => void;
}

function HybridInput({
  label, hint, value, onChange, placeholder, rows = 8, onExtractingChange,
}: HybridInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [sourceFile, setSourceFile] = useState<string | null>(null);
  const [justFilled, setJustFilled] = useState(false);

  const setEx = (v: boolean) => { setExtracting(v); onExtractingChange?.(v); };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setEx(true);
    setExtractError(null);
    setJustFilled(false);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/extract-text", { method: "POST", body: fd });
      const data = await res.json() as { text?: string; error?: string; error_code?: string };
      if (!res.ok || data.error) {
        if (data.error_code === "INVALID_IMAGE_CONTENT") {
          setExtractError("未识别到有效信息，请重新插入图片");
        } else {
          setExtractError(data.error ?? "提取失败");
        }
        return;
      }
      // 前端后处理拦截：防止原始 JSON / markdown 泄漏到输入框
      const sanitized = sanitizeOcrText(data.text ?? "");
      if (!sanitized.isValid) {
        setExtractError("未识别到有效信息，请重新插入图片");
        return;
      }
      onChange(sanitized.text);
      setSourceFile(file.name);
      setJustFilled(true);
      setTimeout(() => setJustFilled(false), 2500);
    } catch {
      setExtractError("网络错误，请重试");
    } finally {
      setEx(false);
    }
  };

  const clearFile = () => { setSourceFile(null); setExtractError(null); onChange(""); };

  return (
    <div className="card-cyber-cyan flex flex-col gap-2 rounded-xl p-4">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-mono font-bold tracking-widest text-neon-cyan/80 uppercase">
          {label}
          {hint && <span className="ml-2 font-normal normal-case tracking-normal text-white/30">{hint}</span>}
        </label>
        {sourceFile && !extracting && (
          <span className="flex items-center gap-1 rounded-full border border-neon-cyan/30 bg-neon-cyan/10 px-2 py-0.5 text-[10px] font-mono text-neon-cyan">
            <span>📄</span>
            <span className="max-w-[100px] truncate">{sourceFile}</span>
            <button onClick={clearFile} className="ml-0.5 text-neon-cyan/50 hover:text-neon-cyan">✕</button>
          </span>
        )}
      </div>

      <div className={`relative rounded-lg transition-all duration-300 ${
        justFilled ? "ring-2 ring-yellow-400/60 shadow-[0_0_16px_rgba(250,204,21,0.2)]" : ""
      }`}>
        <textarea
          value={value}
          onChange={(e) => { setSourceFile(null); onChange(e.target.value); }}
          placeholder={extracting ? "正在提取文字…" : placeholder}
          rows={rows}
          disabled={extracting}
          className={`terminal-input-cyan w-full resize-none rounded-lg px-3 py-3 pb-10 text-sm leading-relaxed placeholder:text-white/20 ${
            extracting ? "cursor-wait opacity-60" : ""
          } ${justFilled ? "bg-yellow-400/5" : ""}`}
        />
        {extracting && (
          <div className="absolute bottom-3 left-3 flex items-center gap-1.5 text-[10px] font-mono text-neon-cyan">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-neon-cyan/30 border-t-neon-cyan" />
            提取中…
          </div>
        )}
        {justFilled && (
          <div className="absolute bottom-3 left-3 flex items-center gap-1 text-[10px] font-mono text-yellow-400">
            <span>✦</span> 已自动填入
          </div>
        )}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={extracting}
          title="上传 PDF / JPG / PNG"
          className={`absolute bottom-2.5 right-2.5 flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[10px] font-mono font-bold transition-all ${
            extracting
              ? "cursor-wait border-white/10 text-white/20"
              : "border-neon-cyan/30 text-neon-cyan/60 hover:border-neon-cyan/70 hover:bg-neon-cyan/10 hover:text-neon-cyan"
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
          上传文件
        </button>
        <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={handleFileChange} />
      </div>

      {extractError && (
        <p className="flex items-center gap-1 text-[10px] font-mono text-red-400">⚠ {extractError}</p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// JdTranslationPanel：JD 大白话翻译结果面板
// ─────────────────────────────────────────────────────────────
function JdTranslationPanel({
  data,
  onClose,
}: {
  data: TranslatedJd;
  onClose: () => void;
}) {
  return (
    <div className="relative w-full rounded-xl border border-amber-400/20 bg-black/60 p-4 backdrop-blur-md"
      style={{ boxShadow: "0 0 24px rgba(251,191,36,0.08), inset 0 0 24px rgba(0,0,0,0.4)" }}>

      {/* 标题栏 */}
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-mono font-bold uppercase tracking-widest text-amber-400">
          <span style={{ filter: "drop-shadow(0 0 4px rgba(251,191,36,0.8))" }}>⚡</span>
          AI 说人话 · JD 翻译报告
        </span>
        <button
          onClick={onClose}
          className="rounded border border-white/10 px-2 py-0.5 text-[10px] font-mono text-white/25 hover:border-white/30 hover:text-white/50 transition-colors"
        >
          收起
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {/* 到底要干嘛 */}
        <div className="rounded-lg border border-amber-400/15 bg-amber-400/5 px-3 py-2.5">
          <p className="mb-1 text-[9px] font-mono uppercase tracking-widest text-amber-400/60">🔥 到底要干嘛</p>
          <p className="text-sm leading-relaxed text-amber-100/85">{data.real_duty}</p>
        </div>

        {/* 硬性门槛 */}
        {data.hard_requirements.length > 0 && (
          <div className="rounded-lg border border-red-400/15 bg-red-500/5 px-3 py-2.5">
            <p className="mb-2 text-[9px] font-mono uppercase tracking-widest text-red-400/60">⚠️ 没这金刚钻别揽瓷器活</p>
            <ul className="flex flex-col gap-1.5">
              {data.hard_requirements.map((req, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-red-200/80">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-red-400" />
                  {req}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 加分项 */}
        {data.nice_to_have.length > 0 && (
          <div className="rounded-lg border border-neon-cyan/15 bg-neon-cyan/5 px-3 py-2.5">
            <p className="mb-2 text-[9px] font-mono uppercase tracking-widest text-neon-cyan/50">✨ 如果有更好</p>
            <ul className="flex flex-col gap-1.5">
              {data.nice_to_have.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-cyan-200/70">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-neon-cyan/60" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 毒舌点评 */}
        {data.toxic_comment && (
          <div className="rounded-lg border border-yellow-400/30 bg-yellow-400/5 px-3 py-2.5">
            <p className="mb-1 text-[9px] font-mono uppercase tracking-widest text-yellow-400/60">💀 毒舌点评</p>
            <p
              className="text-sm font-medium leading-relaxed"
              style={{
                color: "#FFE500",
                textShadow: "0 0 10px rgba(255,229,0,0.5), 0 0 20px rgba(255,229,0,0.2)",
              }}
            >
              {data.toxic_comment}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// GlobalAdviceBlock：整体评价 + 缺失警报
// ─────────────────────────────────────────────────────────────
function GlobalAdviceBlock({ advice, gaps }: { advice: string; gaps: string[] }) {
  return (
    <div className="w-full rounded-xl border border-neon-cyan/25 bg-neon-cyan/5 px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-neon-cyan">
          ✦ HR 整体评价
        </span>
      </div>
      <p className="text-sm leading-relaxed text-cyan-100/85">{advice}</p>

      {gaps.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {gaps.map((gap, i) => (
            <span
              key={i}
              className="flex items-center gap-1 rounded-full border border-red-400/50 bg-red-500/10 px-3 py-1 text-[11px] font-mono font-bold text-red-400"
              style={{ boxShadow: "0 0 8px rgba(248,113,113,0.2)" }}
            >
              <span className="animate-pulse">⚠</span>
              缺失：{gap}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// DiffCard：单条原文 vs 润色后对比卡片
// ─────────────────────────────────────────────────────────────
function DiffCard({ item, index }: { item: PolishedItem; index: number }) {
  const [adopted, setAdopted] = useState(false);

  return (
    <div
      className="w-full rounded-xl border border-white/8 bg-white/5 p-4 backdrop-blur-md transition-all duration-300"
      style={{ boxShadow: adopted ? "0 0 16px rgba(0,255,255,0.12)" : "none" }}
    >
      {/* 序号 */}
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] font-mono text-white/20">DIFF · {String(index + 1).padStart(2, "0")}</span>
        <button
          onClick={() => setAdopted((v) => !v)}
          className={`rounded-full border px-2.5 py-0.5 text-[10px] font-mono font-bold transition-all ${
            adopted
              ? "border-neon-cyan/50 bg-neon-cyan/15 text-neon-cyan shadow-[0_0_8px_rgba(0,255,255,0.3)]"
              : "border-white/15 text-white/30 hover:border-white/30"
          }`}
        >
          {adopted ? "✓ 已采纳" : "采纳"}
        </button>
      </div>

      {/* 原文（红色 + 删除线） */}
      <div className="mb-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5">
        <div className="mb-1 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
          <span className="text-[9px] font-mono uppercase tracking-widest text-red-400/60">原文</span>
        </div>
        <p className="text-sm leading-relaxed text-red-400/60 line-through decoration-red-400/40">
          {item.original_text}
        </p>
      </div>

      {/* 润色后（电光青 + 发光） */}
      <div className="mb-3 rounded-lg border border-neon-cyan/25 bg-neon-cyan/5 px-3 py-2.5">
        <div className="mb-1 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-neon-cyan" style={{ boxShadow: "0 0 4px rgba(0,255,255,0.8)" }} />
          <span className="text-[9px] font-mono uppercase tracking-widest text-neon-cyan/70">润色后</span>
        </div>
        <p
          className="text-sm leading-relaxed"
          style={{ color: "#00FFFF", textShadow: "0 0 8px rgba(0,255,255,0.35)" }}
        >
          {item.polished_text}
        </p>
      </div>

      {/* 修改原因 */}
      {item.reason && (
        <div className="flex items-start gap-1.5 rounded-md bg-white/3 px-3 py-2">
          <span className="mt-0.5 shrink-0 text-[10px] text-amber-400/70">💡</span>
          <p className="text-xs leading-relaxed text-gray-400">{item.reason}</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// exportWord：仅导出润色后纯文本（不含 diff 和修改原因）
// ─────────────────────────────────────────────────────────────
async function exportWord(items: PolishedItem[], fileName = "polished-resume.docx") {
  const { Document, Paragraph, TextRun, Packer } = await import("docx");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children: any[] = [];

  for (const item of items) {
    for (const line of item.polished_text.split("\n")) {
      children.push(new Paragraph({ children: [new TextRun({ text: line || " " })] }));
    }
    children.push(new Paragraph({ text: "" }));
  }

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────
// SelfIntroPanel：赛博提词器风格的面试自我介绍面板
// ─────────────────────────────────────────────────────────────
function SelfIntroPanel({
  data,
  onClose,
}: {
  data: SelfIntroData;
  onClose: () => void;
}) {
  const segments = [
    { label: "开场破冰", sublabel: "HOOK", text: data.hook, color: "cyan" as const },
    { label: "高光经历", sublabel: "PAST", text: data.past_experience, color: "purple" as const },
    { label: "未来价值", sublabel: "FUTURE", text: data.future_value, color: "cyan" as const },
  ];

  return (
    <div
      className="relative w-full rounded-xl border border-neon-purple/30 bg-black/80 p-5 backdrop-blur-md"
      style={{ boxShadow: "0 0 32px rgba(157,78,221,0.12), inset 0 0 32px rgba(0,0,0,0.6)" }}
    >
      {/* 标题栏 */}
      <div className="mb-4 flex items-center justify-between">
        <span className="flex items-center gap-2 text-[11px] font-mono font-bold uppercase tracking-widest text-neon-purple">
          <span style={{ filter: "drop-shadow(0 0 5px rgba(157,78,221,0.9))" }}>🎙</span>
          面试自我介绍 · 提词器模式
        </span>
        <button
          onClick={onClose}
          className="rounded border border-white/10 px-2 py-0.5 text-[10px] font-mono text-white/25 hover:border-white/30 hover:text-white/50 transition-colors"
        >
          收起
        </button>
      </div>

      {/* 三段式内容 */}
      <div className="flex flex-col gap-3">
        {segments.map((seg) => (
          <div
            key={seg.sublabel}
            className={`rounded-xl border px-4 py-3.5 ${
              seg.color === "purple"
                ? "border-neon-purple/20 bg-neon-purple/5"
                : "border-neon-cyan/20 bg-neon-cyan/5"
            }`}
          >
            <div className="mb-2 flex items-center gap-2">
              <span
                className={`text-[9px] font-mono font-bold uppercase tracking-widest ${
                  seg.color === "purple" ? "text-neon-purple/60" : "text-neon-cyan/60"
                }`}
              >
                {seg.sublabel}
              </span>
              <span className="text-[9px] font-mono text-white/25">·</span>
              <span className="text-[9px] font-mono text-white/40">{seg.label}</span>
            </div>
            <p
              className="text-base leading-[1.9] tracking-wide"
              style={
                seg.color === "purple"
                  ? { color: "#C084FC", textShadow: "0 0 10px rgba(192,132,252,0.3)" }
                  : { color: "#E0FFFF", textShadow: "0 0 8px rgba(0,255,255,0.2)" }
              }
            >
              {seg.text}
            </p>
          </div>
        ))}
      </div>

      {/* 教练批注 */}
      {data.coach_tips.length > 0 && (
        <div className="mt-4 rounded-xl border border-yellow-400/20 bg-yellow-400/5 px-4 py-3">
          <p className="mb-2.5 text-[9px] font-mono font-bold uppercase tracking-widest text-yellow-400/70">
            ⚡ 教练私房批注
          </p>
          <ul className="flex flex-col gap-2">
            {data.coach_tips.map((tip, i) => (
              <li key={i} className="flex items-start gap-2">
                <span
                  className="mt-0.5 shrink-0 text-[10px] font-mono font-bold"
                  style={{ color: "#FFE500", textShadow: "0 0 6px rgba(255,229,0,0.6)" }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  className="text-sm leading-relaxed"
                  style={{ color: "#FFE500", textShadow: "0 0 8px rgba(255,229,0,0.3)" }}
                >
                  {tip}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────────────────────
export default function PolishingView() {
  const router = useRouter();
  const [resumeText, setResumeText] = useState("");
  const [jdText, setJdText] = useState("");
  const [resumeExtracting, setResumeExtracting] = useState(false);
  const [jdExtracting, setJdExtracting] = useState(false);
  const [wordExporting, setWordExporting] = useState(false);
  const [isTranslatingJd, setIsTranslatingJd] = useState(false);
  const [translatedJdData, setTranslatedJdData] = useState<TranslatedJd | null>(null);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [isGeneratingIntro, setIsGeneratingIntro] = useState(false);
  const [introData, setIntroData] = useState<SelfIntroData | null>(null);
  const [introError, setIntroError] = useState<string | null>(null);

  type Status = "idle" | "loading" | "done" | "error";
  const [status, setStatus] = useState<Status>("idle");
  const [progressLabel, setProgressLabel] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [result, setResult] = useState<ResultMsg | null>(null);

  const handleAnalyze = async () => {
    setStatus("loading");
    setProgressLabel("准备中…");
    setResult(null);
    setErrorMsg("");
    try {
      const res = await fetch("/api/analyze-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText, jdText }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const ln of lines) {
          if (!ln.trim()) continue;
          try {
            const msg = JSON.parse(ln) as PipelineMsg;
            if (msg.type === "progress") { setProgressLabel(msg.label); }
            else if (msg.type === "result") { setResult(msg); setStatus("done"); }
            else if (msg.type === "error")  { setErrorMsg(msg.message); setStatus("error"); }
          } catch { /* ignore partial */ }
        }
      }
      if (buffer.trim()) {
        try {
          const msg = JSON.parse(buffer) as PipelineMsg;
          if (msg.type === "result") { setResult(msg); setStatus("done"); }
          if (msg.type === "error")  { setErrorMsg(msg.message); setStatus("error"); }
        } catch { /* ignore */ }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "网络请求失败");
      setStatus("error");
    }
  };

  const handleTranslateJd = async () => {
    if (!jdText.trim() || isTranslatingJd) return;
    setIsTranslatingJd(true);
    setTranslateError(null);
    setTranslatedJdData(null);
    try {
      const res = await fetch("/api/translate-jd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jdText }),
      });
      const json = await res.json() as { data?: TranslatedJd; error?: string };
      if (!res.ok || json.error) {
        setTranslateError(json.error ?? "翻译失败，请重试");
        return;
      }
      if (json.data) setTranslatedJdData(json.data);
    } catch {
      setTranslateError("网络错误，请重试");
    } finally {
      setIsTranslatingJd(false);
    }
  };

  const handleGenerateIntro = async () => {
    if (isGeneratingIntro) return;
    setIsGeneratingIntro(true);
    setIntroError(null);
    setIntroData(null);
    try {
      const res = await fetch("/api/self-intro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText, jdText }),
      });
      const json = await res.json() as { data?: SelfIntroData; error?: string };
      if (!res.ok || json.error) {
        setIntroError(json.error ?? "生成失败，请重试");
        return;
      }
      if (json.data) setIntroData(json.data);
    } catch {
      setIntroError("网络错误，请重试");
    } finally {
      setIsGeneratingIntro(false);
    }
  };

  const handleExportWord = async () => {
    if (!result) return;
    setWordExporting(true);
    try { await exportWord(result.polished_items); } finally { setWordExporting(false); }
  };

  // 导出 PDF 专用：仅打印润色后纯文本
  const handleExportPDF = () => window.print();

  const anyExtracting = resumeExtracting || jdExtracting;
  const canAnalyze = !anyExtracting && status !== "loading"
    && resumeText.trim().length > 20 && jdText.trim().length > 20;

  // 润色全文拼接（用于打印）
  const polishedFullText = result
    ? result.polished_items.map((item) => item.polished_text).join("\n\n")
    : "";

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-cyber-bg md:flex-row print:block print:h-auto print:overflow-visible">

      {/* ══ 隐藏的打印内容（仅 PDF 导出时可见）══════════════════ */}
      <div className="hidden print:block print:p-10">
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-black">
          {polishedFullText}
        </pre>
      </div>

      {/* ══ 左侧：输入区 (40%) ════════════════════════════════ */}
      <div className="panel-cyber-cyan flex h-1/2 flex-col md:h-full md:w-2/5 print:hidden">

        <div className="header-cyber-cyan shrink-0 flex items-center gap-3 px-5 py-3">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex items-center gap-1 rounded-md border border-neon-cyan/20 px-2 py-1 text-[10px] font-mono text-neon-cyan/70 hover:border-neon-cyan/60 hover:text-neon-cyan transition-colors cursor-pointer"
          >
            ← HOME
          </button>
          <span className="text-sm font-bold tracking-widest text-white/90 uppercase">
            简历 <span className="text-neon-cyan">润色</span>
          </span>
          {status === "loading" && (
            <span className="ml-auto flex items-center gap-1.5 text-[10px] font-mono text-neon-cyan animate-pulse">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-neon-cyan" />
              ANALYZING
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          <HybridInput
            label="我的简历"
            hint="粘贴 或 上传 PDF / 图片"
            value={resumeText}
            onChange={setResumeText}
            placeholder={"粘贴简历文字…\n\n或点击右下角「上传文件」按钮\n支持 PDF / JPG / PNG，AI 自动识别填入"}
            rows={9}
            onExtractingChange={setResumeExtracting}
          />
          <HybridInput
            label="目标岗位 JD"
            hint="粘贴 或 上传截图"
            value={jdText}
            onChange={(v) => { setJdText(v); setTranslatedJdData(null); setTranslateError(null); }}
            placeholder={"粘贴招聘 JD…\n\n或上传 JD 截图，AI 自动识别"}
            rows={8}
            onExtractingChange={setJdExtracting}
          />

          {/* [ AI 说人话 ] 翻译按钮 */}
          {jdText.trim().length > 10 && (
            <button
              type="button"
              onClick={handleTranslateJd}
              disabled={isTranslatingJd}
              className={`-mt-2 flex w-full items-center justify-center gap-2 rounded-lg border py-2 text-[11px] font-mono font-bold uppercase tracking-widest transition-all ${
                isTranslatingJd
                  ? "cursor-wait border-amber-400/20 text-amber-400/30"
                  : "border-amber-400/30 text-amber-400/70 hover:border-amber-400/60 hover:bg-amber-400/8 hover:text-amber-400"
              }`}
              style={
                isTranslatingJd
                  ? undefined
                  : { boxShadow: "0 0 12px rgba(251,191,36,0.06)" }
              }
            >
              {isTranslatingJd ? (
                <>
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-amber-400/20 border-t-amber-400" />
                  翻译中…
                </>
              ) : (
                <>
                  <span style={{ filter: "drop-shadow(0 0 3px rgba(251,191,36,0.6))" }}>⚡</span>
                  [ AI 说人话 ]
                </>
              )}
            </button>
          )}

          {/* 翻译错误提示 */}
          {translateError && (
            <p className="text-[10px] font-mono text-red-400">⚠ {translateError}</p>
          )}

          {/* 翻译结果面板 */}
          {translatedJdData && (
            <JdTranslationPanel
              data={translatedJdData}
              onClose={() => setTranslatedJdData(null)}
            />
          )}

          {anyExtracting && (
            <p className="text-center text-[10px] font-mono text-neon-cyan/60 animate-pulse">
              ◦ 文件提取中，完成后即可开始分析 ◦
            </p>
          )}

          <button
            onClick={handleAnalyze}
            disabled={!canAnalyze}
            className={`mt-auto w-full rounded-lg border py-2.5 text-sm font-mono font-bold uppercase tracking-widest transition-all ${
              canAnalyze
                ? "border-neon-cyan/50 bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20 shadow-[0_0_16px_rgba(0,255,255,0.15)]"
                : "border-white/10 text-white/20 cursor-not-allowed"
            }`}
          >
            {status === "loading" ? "[ ANALYZING… ]"
              : anyExtracting ? "[ EXTRACTING… ]"
              : "[ START ANALYSIS ]"}
          </button>
        </div>
      </div>

      {/* ══ 右侧：结果区 (60%) ═══════════════════════════════ */}
      <div className="relative flex h-1/2 flex-1 flex-col overflow-hidden md:h-full print:hidden">
        {/* 背景网格 */}
        <div className="pointer-events-none absolute inset-0" style={{
          backgroundImage: "linear-gradient(rgba(0,255,255,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,255,0.04) 1px,transparent 1px)",
          backgroundSize: "44px 44px",
        }} />
        <div className="pointer-events-none absolute -top-20 left-1/2 h-40 w-80 -translate-x-1/2 rounded-full bg-neon-cyan/5 blur-3xl" />

        {/* 标题栏（含导出按钮） */}
        <div className="relative flex shrink-0 items-center justify-between border-b border-white/5 px-5 py-3">
          <span className="text-xs font-mono tracking-widest text-white/30 uppercase">
            diff · result
          </span>
          {result && (
            <div className="flex items-center gap-2">
              {/* 导出 PDF */}
              <button
                onClick={handleExportPDF}
                title="导出 PDF（仅润色内容）"
                className="flex items-center gap-1.5 rounded-md border border-white/15 px-2.5 py-1.5 text-[10px] font-mono text-white/40 transition-colors hover:border-neon-cyan/40 hover:text-neon-cyan"
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
                onClick={handleExportWord}
                disabled={wordExporting}
                title="下载 Word (.docx)"
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[10px] font-mono transition-colors ${
                  wordExporting
                    ? "cursor-wait border-white/10 text-white/20"
                    : "border-neon-cyan/25 text-neon-cyan/60 hover:border-neon-cyan/60 hover:bg-neon-cyan/10 hover:text-neon-cyan"
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
            </div>
          )}
        </div>

        {/* 内容区 */}
        <div className="relative flex-1 overflow-y-auto px-6 py-6">
          <div className="flex flex-col items-center gap-4">

            {/* 加载中 */}
            {status === "loading" && (
              <div className="flex flex-col items-center gap-4 py-20">
                <div className="relative flex size-16 items-center justify-center">
                  <div className="absolute inset-0 animate-ping rounded-full border border-neon-cyan/30" />
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-neon-cyan/20 border-t-neon-cyan" />
                </div>
                <p className="text-center text-xs font-mono text-neon-cyan/70 animate-pulse">{progressLabel}</p>
              </div>
            )}

            {/* 错误 */}
            {status === "error" && (
              <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-xl border border-red-400/20 bg-red-500/5 p-6 text-center">
                <span className="font-mono text-2xl text-red-400">⚠</span>
                <p className="text-sm font-mono text-red-400">{errorMsg}</p>
                <p className="text-[10px] text-white/30">请检查内容是否完整，或稍后重试</p>
              </div>
            )}

            {/* 完成 */}
            {status === "done" && result && (
              <div className="w-full max-w-2xl flex flex-col gap-4">
                {/* 向量匹配分数 */}
                <div className="flex items-center justify-between w-full px-1">
                  <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest">
                    余弦向量匹配分
                  </span>
                  <span
                    className={`text-2xl font-bold font-mono tabular-nums ${
                      result.score >= 75 ? "text-neon-cyan" :
                      result.score >= 50 ? "text-amber-400" : "text-red-400"
                    }`}
                    style={{
                      textShadow: result.score >= 75
                        ? "0 0 12px rgba(0,255,255,0.6)"
                        : result.score >= 50
                        ? "0 0 12px rgba(245,158,11,0.6)"
                        : "0 0 12px rgba(248,113,113,0.6)",
                    }}
                  >
                    {result.score}
                    <span className="text-sm font-normal text-white/30 ml-0.5">/100</span>
                  </span>
                </div>

                {/* 全局评价 + 缺失警报 */}
                <GlobalAdviceBlock
                  advice={result.global_advice}
                  gaps={result.jd_missing_gap}
                />

                {/* diff 计数 */}
                <div className="flex items-center gap-2 px-1">
                  <div className="h-px flex-1 bg-white/8" />
                  <span className="text-[10px] font-mono text-white/25">
                    {result.polished_items.length} 处靶向优化
                  </span>
                  <div className="h-px flex-1 bg-white/8" />
                </div>

                {/* Diff 卡片列表 */}
                {result.polished_items.map((item, i) => (
                  <DiffCard key={i} item={item} index={i} />
                ))}

                {result.polished_items.length === 0 && (
                  <p className="text-center text-sm font-mono text-white/30">
                    AI 未返回具体优化条目，请检查简历内容后重试
                  </p>
                )}

                {/* 分隔线 */}
                <div className="flex items-center gap-3 py-1">
                  <div className="h-px flex-1 bg-neon-purple/20" />
                  <span className="text-[10px] font-mono text-neon-purple/40">下一步</span>
                  <div className="h-px flex-1 bg-neon-purple/20" />
                </div>

                {/* 生成面试自我介绍按钮 */}
                <button
                  type="button"
                  onClick={handleGenerateIntro}
                  disabled={isGeneratingIntro}
                  className={`flex w-full items-center justify-center gap-2.5 rounded-xl border py-3 text-sm font-mono font-bold uppercase tracking-widest transition-all ${
                    isGeneratingIntro
                      ? "cursor-wait border-neon-purple/20 text-neon-purple/30"
                      : "border-neon-purple/40 text-neon-purple/80 hover:border-neon-purple/70 hover:bg-neon-purple/10 hover:text-neon-purple"
                  }`}
                  style={
                    isGeneratingIntro
                      ? undefined
                      : { boxShadow: "0 0 20px rgba(157,78,221,0.1)" }
                  }
                >
                  {isGeneratingIntro ? (
                    <>
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-neon-purple/20 border-t-neon-purple" />
                      生成中…
                    </>
                  ) : (
                    <>
                      <span style={{ filter: "drop-shadow(0 0 4px rgba(157,78,221,0.8))" }}>🎙</span>
                      [ 生成面试自我介绍 ]
                    </>
                  )}
                </button>

                {introError && (
                  <p className="text-center text-[10px] font-mono text-red-400">⚠ {introError}</p>
                )}

                {/* 提词器面板 */}
                {introData && (
                  <SelfIntroPanel
                    data={introData}
                    onClose={() => setIntroData(null)}
                  />
                )}
              </div>
            )}

            {/* 空状态 */}
            {status === "idle" && (
              <div className="mt-16 flex flex-col items-center gap-4 text-center">
                <div className="flex size-16 items-center justify-center rounded-2xl border border-neon-cyan/20 bg-neon-cyan/5">
                  <span className="text-2xl text-neon-cyan opacity-50">◈</span>
                </div>
                <p className="text-sm font-mono text-white/30">在左侧填入简历与 JD</p>
                <p className="text-[10px] font-mono text-white/15">
                  AI 将逐句对比原文，输出靶向 Diff 润色结果
                </p>
              </div>
            )}

          </div>
        </div>
      </div>

    </div>
  );
}
