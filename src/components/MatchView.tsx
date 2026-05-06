"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { track } from "@vercel/analytics";
import ReactMarkdown from "react-markdown";
import type {
  PipelineMsg,
  ResultMsg,
  RefineAdviceItem,
  WeightMatrixItem,
} from "@/app/api/analyze-resume/route";
import type { TranslatedJd } from "@/app/api/translate-jd/route";
import type { SelfIntroData } from "@/app/api/self-intro/route";
import { saveAssessment, trackEvent } from "@/app/actions/db";

// ── OCR 后处理拦截器 ──────────────────────────────────────────
// 防弹级三步兜底，无论大模型返回什么垃圾格式都不崩溃
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

// ── Word 导出 ─────────────────────────────────────────────────
async function exportWord(items: RefineAdviceItem[], fileName = "polished-resume.docx") {
  const { Document, Paragraph, TextRun, Packer } = await import("docx");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children: any[] = [];
  for (const item of items) {
    for (const line of item.polished_text.split("\n")) {
      children.push(new Paragraph({ children: [new TextRun({ text: line || " " })] }));
    }
    children.push(new Paragraph({ text: "" }));
  }
  const doc  = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  const url  = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = fileName; a.click();
  URL.revokeObjectURL(url);
}

// ── 情绪兜底：低分包装话术 ────────────────────────────────────
function getScoreEmotion(score: number): {
  label: string;
  message: string;
  colorClass: string;
  bgClass: string;
  borderClass: string;
} {
  if (score < 30) {
    return {
      label: "发现一片蓝海",
      message: "当前经历与岗位重合度较低，但这正是成长空间所在。建议优先补齐核心项技能，或转向与现有经历更匹配的岗位方向。",
      colorClass: "text-m-sage",
      bgClass:    "bg-m-sage/8",
      borderClass: "border-m-sage/22",
    };
  }
  if (score < 55) {
    return {
      label: "初具匹配潜力",
      message: "核心技能有一定基础，重点突破加分项将显著提升竞争力。参考下方润色建议，将经历向 JD 关键词靠拢。",
      colorClass: "text-m-slate",
      bgClass:    "bg-m-slate/8",
      borderClass: "border-m-slate/22",
    };
  }
  if (score < 75) {
    return {
      label: "良好匹配",
      message: "简历与岗位具备良好匹配基础。进一步强化量化数据与 STAR 结构，将使你在筛选阶段脱颖而出。",
      colorClass: "text-m-mauve",
      bgClass:    "bg-m-mauve/8",
      borderClass: "border-m-mauve/22",
    };
  }
  return {
    label: "高度匹配",
    message: "简历与目标岗位高度契合！继续精炼表述，突出核心成果数据，为面试做好准备。",
    colorClass: "text-m-sage",
    bgClass:    "bg-m-sage/10",
    borderClass: "border-m-sage/28",
  };
}

// ── 权重分类标签 ──────────────────────────────────────────────
const CATEGORY_CONFIG: Record<
  WeightMatrixItem["category"],
  { label: string; weight: string; colorClass: string; bgClass: string; borderClass: string }
> = {
  core:      { label: "核心项", weight: "W=1.0", colorClass: "text-m-mauve",  bgClass: "bg-m-mauve/8",  borderClass: "border-m-mauve/22" },
  bonus:     { label: "加分项", weight: "W=0.6", colorClass: "text-m-sage",   bgClass: "bg-m-sage/8",   borderClass: "border-m-sage/22"  },
  awareness: { label: "了解项", weight: "W=0.3", colorClass: "text-m-slate",  bgClass: "bg-m-slate/8",  borderClass: "border-m-slate/22" },
};

// ── 加权矩阵展示 ──────────────────────────────────────────────
function WeightMatrixPanel({ matrix }: { matrix: WeightMatrixItem[] }) {
  const coreItems      = matrix.filter((i) => i.category === "core");
  const bonusItems     = matrix.filter((i) => i.category === "bonus");
  const awarenessItems = matrix.filter((i) => i.category === "awareness");

  const groups = [
    { items: coreItems,      ...CATEGORY_CONFIG.core },
    { items: bonusItems,     ...CATEGORY_CONFIG.bonus },
    { items: awarenessItems, ...CATEGORY_CONFIG.awareness },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="w-full rounded-2xl border border-black/6 bg-white/70 backdrop-blur-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-black/5 flex items-center justify-between">
        <span className="text-xs font-semibold text-m-ink tracking-wide">
          加权评估矩阵
        </span>
        <span className="text-[10px] text-m-ink-3">
          Score = Σ(W × S) / ΣW
        </span>
      </div>

      <div className="divide-y divide-black/4">
        {groups.map((group) => (
          <div key={group.label} className="px-5 py-3">
            <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 mb-3 ${group.borderClass} ${group.bgClass}`}>
              <span className={`text-[10px] font-semibold ${group.colorClass}`}>{group.label}</span>
              <span className={`text-[9px] font-mono ${group.colorClass}/70`}>{group.weight}</span>
            </div>

            <div className="flex flex-col gap-2">
              {group.items.map((item, idx) => (
                <div
                  key={`${item.keyword}-${idx}`}
                  className="row-fade-in flex items-center gap-3"
                  style={{ animationDelay: `${idx * 60}ms` }}
                >
                  <span className="w-28 shrink-0 truncate text-xs font-medium text-m-ink" title={item.keyword}>
                    {item.keyword}
                  </span>
                  {/* 进度条 */}
                  <div className="flex-1 h-1.5 rounded-full bg-black/6 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${
                        item.score >= 70 ? "bg-m-sage" :
                        item.score >= 40 ? "bg-m-mauve" :
                        "bg-m-rose/70"
                      }`}
                      style={{ width: `${item.score}%` }}
                    />
                  </div>
                  <span className={`w-9 text-right text-[11px] font-mono font-semibold shrink-0 ${
                    item.score >= 70 ? "text-m-sage" :
                    item.score >= 40 ? "text-m-mauve" :
                    "text-m-rose"
                  }`}>
                    {item.score}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 行级 Diff 卡片 ────────────────────────────────────────────
function DiffCard({ item, index }: { item: RefineAdviceItem; index: number }) {
  const [adopted,  setAdopted]  = useState(false);
  const [copied,   setCopied]   = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(item.polished_text);
    track("polish_copied", { index });
    trackEvent("polish_copied", { index }).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`w-full rounded-2xl border bg-white/72 backdrop-blur-sm p-4 transition-all duration-300 ${
      adopted ? "border-m-sage/35 shadow-sm" : "border-black/6"
    }`}>
      {/* 头部 */}
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] font-mono text-m-ink-4">
          DIFF · {String(index + 1).padStart(2, "0")}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleCopy}
            className={`rounded-lg border px-2.5 py-0.5 text-[10px] font-medium transition-all ${
              copied
                ? "border-m-sage/35 bg-m-sage/10 text-m-sage"
                : "border-black/10 text-m-ink-3 hover:border-m-sage/30 hover:text-m-sage"
            }`}
          >
            {copied ? "已复制 ✓" : "一键复制"}
          </button>
          <button
            onClick={() => setAdopted((v) => !v)}
            className={`rounded-lg border px-2.5 py-0.5 text-[10px] font-medium transition-all ${
              adopted
                ? "border-m-sage/40 bg-m-sage/12 text-m-sage"
                : "border-black/10 text-m-ink-3 hover:border-black/20"
            }`}
          >
            {adopted ? "✓ 采纳" : "采纳"}
          </button>
        </div>
      </div>

      {/* 原文（删除线） */}
      <div className="mb-2.5 rounded-xl border border-red-400/15 bg-red-50/60 px-3.5 py-2.5">
        <div className="mb-1 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-red-400/70" />
          <span className="text-[9px] font-medium uppercase tracking-widest text-red-500/60">原文</span>
        </div>
        <p className="text-sm leading-relaxed text-red-500/55 line-through decoration-red-400/40">
          {item.original_text}
        </p>
      </div>

      {/* 润色后（绿色） */}
      <div className="mb-2.5 rounded-xl border border-m-sage/22 bg-m-sage/6 px-3.5 py-2.5">
        <div className="mb-1 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-m-sage" />
          <span className="text-[9px] font-medium uppercase tracking-widest text-m-sage/70">润色后</span>
        </div>
        <div className="text-sm leading-relaxed text-m-ink prose prose-sm prose-stone max-w-none
          [&_p]:my-0 [&_strong]:font-semibold [&_strong]:text-m-sage">
          <ReactMarkdown>{item.polished_text}</ReactMarkdown>
        </div>
      </div>

      {/* 修改原因 */}
      {item.reason && (
        <div className="flex items-start gap-2 rounded-xl bg-black/3 px-3 py-2">
          <span className="mt-0.5 shrink-0 text-[10px] text-m-slate">💡</span>
          <p className="text-xs leading-relaxed text-m-ink-2">{item.reason}</p>
        </div>
      )}
    </div>
  );
}

// ── 分数显示仪表 ──────────────────────────────────────────────
function ScoreGauge({ score, vectorScore }: { score: number; vectorScore: number | null }) {
  const emotion = getScoreEmotion(score);

  return (
    <div className={`score-reveal w-full rounded-2xl border ${emotion.borderClass} ${emotion.bgClass} p-5`}>
      <div className="flex items-start gap-4">
        {/* 分数数字 */}
        <div className="shrink-0 text-center">
          <div className={`text-5xl font-light tabular-nums ${emotion.colorClass}`}>
            {score}
          </div>
          <div className="text-xs text-m-ink-4 mt-0.5">/100</div>
        </div>

        {/* 分隔线 */}
        <div className={`w-px self-stretch mx-1 ${emotion.bgClass} border-l ${emotion.borderClass}`} />

        {/* 情绪话术 */}
        <div className="flex-1">
          <p className={`text-sm font-semibold mb-1 ${emotion.colorClass}`}>
            {emotion.label}
          </p>
          <p className="text-sm leading-relaxed text-m-ink-2">
            {emotion.message}
          </p>
          {vectorScore !== null && (
            <p className="mt-2 text-[10px] text-m-ink-4">
              余弦向量参考分：{vectorScore} · 加权矩阵主分：{score}
            </p>
          )}
        </div>
      </div>

      {/* 进度条 */}
      <div className="mt-4 h-1.5 w-full rounded-full bg-black/6 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${
            score < 30 ? "bg-m-sage" :
            score < 55 ? "bg-m-slate" :
            score < 75 ? "bg-m-mauve" : "bg-m-sage"
          }`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

// ── HybridInput：文本 + 文件上传 ─────────────────────────────
interface HybridInputProps {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  onExtractingChange?: (v: boolean) => void;
  accentClass?: "sage" | "mauve";
}

function HybridInput({
  label, hint, value, onChange, placeholder, rows = 8,
  onExtractingChange, accentClass = "sage",
}: HybridInputProps) {
  const fileInputRef  = useRef<HTMLInputElement>(null);
  const [extracting,  setExtracting]  = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [sourceFile,  setSourceFile]  = useState<string | null>(null);
  const [justFilled,  setJustFilled]  = useState(false);

  const isSage  = accentClass === "sage";
  const accentBorder = isSage ? "border-m-sage/30" : "border-m-mauve/30";
  const accentText   = isSage ? "text-m-sage"       : "text-m-mauve";
  const accentBg     = isSage ? "bg-m-sage/8"       : "bg-m-mauve/8";

  const setEx = (v: boolean) => { setExtracting(v); onExtractingChange?.(v); };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setEx(true); setExtractError(null); setJustFilled(false);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res  = await fetch("/api/extract-text", { method: "POST", body: fd });
      const data = await res.json() as { text?: string; error?: string; error_code?: string };
      if (!res.ok || data.error) {
        setExtractError(
          data.error_code === "INVALID_IMAGE_CONTENT"
            ? "未识别到有效信息，请重新插入图片"
            : (data.error ?? "提取失败，请重试"),
        );
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

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-black/6 bg-white/65 backdrop-blur-sm p-4">
      <div className="flex items-center justify-between">
        <label className={`text-[11px] font-semibold tracking-widest uppercase ${accentText}`}>
          {label}
          {hint && <span className="ml-2 font-normal normal-case tracking-normal text-m-ink-3">{hint}</span>}
        </label>
        {sourceFile && !extracting && (
          <span className={`flex items-center gap-1 rounded-full border ${accentBorder} ${accentBg} px-2 py-0.5 text-[10px] font-medium ${accentText}`}>
            <span>📄</span>
            <span className="max-w-[100px] truncate">{sourceFile}</span>
            <button
              onClick={() => { setSourceFile(null); setExtractError(null); onChange(""); }}
              className="ml-0.5 opacity-50 hover:opacity-100"
            >
              ✕
            </button>
          </span>
        )}
      </div>

      <div className={`relative rounded-xl transition-all duration-300 ${
        justFilled ? "ring-2 ring-m-sage/30" : ""
      }`}>
        <textarea
          value={value}
          onChange={(e) => { setSourceFile(null); onChange(e.target.value); }}
          placeholder={extracting ? "正在提取文字…" : placeholder}
          rows={rows}
          disabled={extracting}
          className={`w-full resize-none rounded-xl border border-black/8 bg-white/70 px-3.5 py-3 pb-10 text-sm leading-relaxed text-m-ink placeholder:text-m-ink-4/60 focus:outline-none focus:border-m-mauve/40 focus:ring-2 focus:ring-m-mauve/10 transition-all ${
            extracting ? "cursor-wait opacity-60" : ""
          } ${justFilled ? "bg-m-sage/4" : ""}`}
        />
        {extracting && (
          <div className={`absolute bottom-3 left-3 flex items-center gap-1.5 text-[10px] font-medium ${accentText}`}>
            <span className={`inline-block h-3 w-3 animate-spin rounded-full border-2 border-black/10 border-t-current`} />
            提取中…
          </div>
        )}
        {justFilled && (
          <div className="absolute bottom-3 left-3 flex items-center gap-1 text-[10px] font-medium text-m-sage">
            <span>✦</span> 已自动填入
          </div>
        )}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={extracting}
          className={`absolute bottom-2.5 right-2.5 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-medium transition-all ${
            extracting
              ? "cursor-wait border-black/8 text-m-ink-4"
              : `${accentBorder} ${accentText} hover:${accentBg}`
          }`}
        >
          上传文件
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {extractError && (
        <p className="flex items-center gap-1 text-[10px] font-medium text-red-500">
          ⚠ {extractError}
        </p>
      )}
    </div>
  );
}

// ── JD 翻译面板 ───────────────────────────────────────────────
function JdTranslationPanel({ data, onClose }: { data: TranslatedJd; onClose: () => void }) {
  return (
    <div className="w-full rounded-2xl border border-amber-400/18 bg-amber-50/50 backdrop-blur-sm p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-amber-600">
          ⚡ AI 说人话 · JD 翻译
        </span>
        <button
          onClick={onClose}
          className="rounded-lg border border-black/8 px-2 py-0.5 text-[10px] text-m-ink-3 hover:text-m-ink transition-colors"
        >
          收起
        </button>
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="rounded-xl border border-amber-400/15 bg-amber-50/80 px-3.5 py-2.5">
          <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-amber-600/60">到底要干嘛</p>
          <p className="text-sm leading-relaxed text-amber-800/80">{data.real_duty}</p>
        </div>

        {data.hard_requirements.length > 0 && (
          <div className="rounded-xl border border-red-400/12 bg-red-50/60 px-3.5 py-2.5">
            <p className="mb-2 text-[9px] font-semibold uppercase tracking-widest text-red-500/60">没这金刚钻别揽</p>
            <ul className="flex flex-col gap-1">
              {data.hard_requirements.map((req, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-red-700/70">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-red-400/70" />
                  {req}
                </li>
              ))}
            </ul>
          </div>
        )}

        {data.nice_to_have.length > 0 && (
          <div className="rounded-xl border border-m-sage/15 bg-m-sage/5 px-3.5 py-2.5">
            <p className="mb-2 text-[9px] font-semibold uppercase tracking-widest text-m-sage/60">如果有更好</p>
            <ul className="flex flex-col gap-1">
              {data.nice_to_have.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-m-ink-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-m-sage/60" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {data.toxic_comment && (
          <div className="rounded-xl border border-amber-400/25 bg-amber-100/50 px-3.5 py-2.5">
            <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-amber-600/60">毒舌点评</p>
            <p className="text-sm font-medium leading-relaxed text-amber-700">{data.toxic_comment}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 自我介绍面板 ──────────────────────────────────────────────
function SelfIntroPanel({ data, onClose }: { data: SelfIntroData; onClose: () => void }) {
  const segments = [
    { label: "开场破冰", sub: "HOOK",   text: data.hook,            accent: "mauve" as const },
    { label: "高光经历", sub: "PAST",   text: data.past_experience, accent: "sage"  as const },
    { label: "未来价值", sub: "FUTURE", text: data.future_value,    accent: "mauve" as const },
  ];

  return (
    <div className="w-full rounded-2xl border border-m-mauve/20 bg-white/75 backdrop-blur-sm p-5">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-m-mauve">
          🎙 面试自我介绍 · 提词器
        </span>
        <button
          onClick={onClose}
          className="rounded-lg border border-black/8 px-2 py-0.5 text-[10px] text-m-ink-3 hover:text-m-ink transition-colors"
        >
          收起
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {segments.map((seg) => (
          <div
            key={seg.sub}
            className={`rounded-xl border px-4 py-3.5 ${
              seg.accent === "mauve"
                ? "border-m-mauve/18 bg-m-mauve/5"
                : "border-m-sage/18 bg-m-sage/5"
            }`}
          >
            <div className="mb-2 flex items-center gap-2">
              <span className={`text-[9px] font-semibold uppercase tracking-widest ${
                seg.accent === "mauve" ? "text-m-mauve/60" : "text-m-sage/60"
              }`}>{seg.sub}</span>
              <span className="text-[9px] text-m-ink-4">·</span>
              <span className="text-[9px] text-m-ink-3">{seg.label}</span>
            </div>
            <p className={`text-base leading-[1.9] tracking-wide ${
              seg.accent === "mauve" ? "text-m-mauve" : "text-m-sage"
            }`}>
              {seg.text}
            </p>
          </div>
        ))}
      </div>

      {data.coach_tips.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-400/18 bg-amber-50/60 px-4 py-3">
          <p className="mb-2 text-[9px] font-semibold uppercase tracking-widest text-amber-600/60">
            教练私房建议
          </p>
          <ul className="flex flex-col gap-1.5">
            {data.coach_tips.map((tip, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="shrink-0 text-[10px] font-mono font-bold text-amber-600">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-sm leading-relaxed text-amber-700">{tip}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────
export default function MatchView() {
  const router = useRouter();
  const [resumeText, setResumeText] = useState("");
  const [jdText,     setJdText]     = useState("");
  const [resumeExtracting, setResumeExtracting] = useState(false);
  const [jdExtracting,     setJdExtracting]     = useState(false);
  const [wordExporting,    setWordExporting]    = useState(false);

  const [isTranslatingJd,  setIsTranslatingJd]  = useState(false);
  const [translatedJdData, setTranslatedJdData] = useState<TranslatedJd | null>(null);
  const [translateError,   setTranslateError]   = useState<string | null>(null);

  const [isGeneratingIntro, setIsGeneratingIntro] = useState(false);
  const [introData,         setIntroData]         = useState<SelfIntroData | null>(null);
  const [introError,        setIntroError]        = useState<string | null>(null);

  type Status = "idle" | "loading" | "done" | "error";
  const [status,        setStatus]        = useState<Status>("idle");
  const [progressLabel, setProgressLabel] = useState("");
  const [errorMsg,      setErrorMsg]      = useState("");
  const [result,        setResult]        = useState<ResultMsg | null>(null);

  useEffect(() => { track("match_enter"); trackEvent("match_enter").catch(() => {}); }, []);

  const handleAnalyze = async () => {
    setStatus("loading"); setProgressLabel("准备中…");
    setResult(null); setErrorMsg("");
    try {
      const res = await fetch("/api/analyze-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText, jdText }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = "";

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
            if (msg.type === "progress") setProgressLabel(msg.label);
            else if (msg.type === "result") {
                setResult(msg); setStatus("done");
                track("match_analyzed", { score: msg.total_score });
                trackEvent("match_analyzed", { score: msg.total_score }).catch(() => {});
                saveAssessment(jdText, msg).catch(() => {});
              }
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
    setIsTranslatingJd(true); setTranslateError(null); setTranslatedJdData(null);
    try {
      const res  = await fetch("/api/translate-jd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jdText }),
      });
      const json = await res.json() as { data?: TranslatedJd; error?: string };
      if (!res.ok || json.error) { setTranslateError(json.error ?? "翻译失败"); return; }
      if (json.data) { setTranslatedJdData(json.data); track("jd_translated"); trackEvent("jd_translated").catch(() => {}); }
    } catch { setTranslateError("网络错误，请重试"); }
    finally   { setIsTranslatingJd(false); }
  };

  const handleGenerateIntro = async () => {
    if (isGeneratingIntro) return;
    setIsGeneratingIntro(true); setIntroError(null); setIntroData(null);
    try {
      const res  = await fetch("/api/self-intro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText, jdText }),
      });
      const json = await res.json() as { data?: SelfIntroData; error?: string };
      if (!res.ok || json.error) { setIntroError(json.error ?? "生成失败"); return; }
      if (json.data) { setIntroData(json.data); track("self_intro_generated"); trackEvent("self_intro_generated").catch(() => {}); }
    } catch { setIntroError("网络错误，请重试"); }
    finally   { setIsGeneratingIntro(false); }
  };

  const handleExportWord = async () => {
    if (!result) return;
    setWordExporting(true);
    try {
      await exportWord(result.refine_advice);
      track("match_exported", { format: "word" });
      trackEvent("match_exported", { format: "word" }).catch(() => {});
    }
    finally { setWordExporting(false); }
  };

  const anyExtracting = resumeExtracting || jdExtracting;
  const canAnalyze    = !anyExtracting && status !== "loading"
    && resumeText.trim().length > 20 && jdText.trim().length > 20;

  const polishedFullText = result
    ? result.refine_advice.map((i) => i.polished_text).join("\n\n")
    : "";

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden md:flex-row print:block print:h-auto print:overflow-visible">

      {/* 打印内容 */}
      <div className="hidden print:block print:p-10">
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-black">
          {polishedFullText}
        </pre>
      </div>

      {/* ══ 左侧输入区 (40%) ════════════════════════════════════ */}
      <div className="glass-panel flex h-1/2 flex-col md:h-full md:w-2/5 print:hidden">

        {/* 顶部导航 */}
        <div className="glass-header shrink-0 flex items-center gap-3 px-5 py-3">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex items-center gap-1.5 rounded-lg border border-m-ink-4/30 bg-white/50 px-2.5 py-1 text-[10px] font-medium text-m-ink-2 hover:border-m-sage/40 hover:text-m-sage transition-colors"
          >
            ← 首页
          </button>
          <span className="text-sm font-medium tracking-wide text-m-ink">
            简历匹配
            <span className="ml-1.5 text-m-sage">·</span>
            <span className="ml-1.5 text-m-sage text-xs font-normal">精准润色</span>
          </span>
          {status === "loading" && (
            <span className="ml-auto flex items-center gap-1.5 text-[10px] text-m-sage animate-pulse">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-m-sage" />
              分析中
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          <HybridInput
            label="我的简历"
            hint="粘贴 或 上传 PDF / 图片"
            value={resumeText}
            onChange={setResumeText}
            placeholder={"将简历全文粘贴于此\n\n或点击右下角「上传文件」\n支持 PDF / JPG / PNG，AI 自动识别并填入"}
            rows={9}
            onExtractingChange={setResumeExtracting}
            accentClass="mauve"
          />

          <HybridInput
            label="目标岗位 JD"
            hint="粘贴 或 上传截图"
            value={jdText}
            onChange={(v) => {
              setJdText(v);
              setTranslatedJdData(null);
              setTranslateError(null);
            }}
            placeholder={"将招聘 JD 粘贴于此\n\nAI 将自动识别三级技能权重\n核心项 W=1.0 · 加分项 W=0.6 · 了解项 W=0.3"}
            rows={8}
            onExtractingChange={setJdExtracting}
            accentClass="sage"
          />

          {/* AI 说人话按钮 */}
          {jdText.trim().length > 10 && (
            <button
              type="button"
              onClick={handleTranslateJd}
              disabled={isTranslatingJd}
              className={`-mt-1 flex w-full items-center justify-center gap-2 rounded-xl border py-2 text-[11px] font-semibold uppercase tracking-widest transition-all ${
                isTranslatingJd
                  ? "cursor-wait border-amber-400/15 text-amber-500/40"
                  : "border-amber-400/28 text-amber-600/75 hover:border-amber-400/50 hover:bg-amber-50/50"
              }`}
            >
              {isTranslatingJd ? (
                <>
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-amber-400/20 border-t-amber-500" />
                  翻译中…
                </>
              ) : "⚡ AI 说人话"}
            </button>
          )}

          {translateError && <p className="text-[10px] font-medium text-red-500">⚠ {translateError}</p>}
          {translatedJdData && (
            <JdTranslationPanel data={translatedJdData} onClose={() => setTranslatedJdData(null)} />
          )}

          {anyExtracting && (
            <p className="text-center text-[10px] font-medium text-m-sage/70 animate-pulse">
              文件提取中，完成后即可开始分析…
            </p>
          )}

          {/* 开始分析按钮 */}
          <button
            onClick={handleAnalyze}
            disabled={!canAnalyze}
            className={`mt-auto w-full rounded-xl border py-2.5 text-sm font-semibold uppercase tracking-wider transition-all ${
              canAnalyze
                ? "border-m-sage/40 bg-m-sage/10 text-m-sage hover:bg-m-sage/18 shadow-sm"
                : "border-black/8 text-m-ink-4 cursor-not-allowed"
            }`}
          >
            {status === "loading" ? "分析中…"
              : anyExtracting ? "提取中…"
              : "开始匹配分析"}
          </button>
        </div>
      </div>

      {/* ══ 右侧结果区 (60%) ════════════════════════════════════ */}
      <div className="relative flex h-1/2 flex-1 flex-col overflow-hidden md:h-full print:hidden">
        {/* 背景纹理 */}
        <div className="pointer-events-none absolute inset-0 cyber-grid opacity-35" />

        {/* 标题栏 */}
        <div className="relative flex shrink-0 items-center justify-between border-b border-black/5 bg-white/55 px-5 py-3 backdrop-blur-sm">
          <span className="text-xs font-medium tracking-widest text-m-ink-4 uppercase">
            匹配结果 · Diff 视图
          </span>
          {result && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => { window.print(); track("match_exported", { format: "pdf" }); trackEvent("match_exported", { format: "pdf" }).catch(() => {}); }}
                className="flex items-center gap-1.5 rounded-lg border border-black/10 bg-white/60 px-2.5 py-1.5 text-[10px] font-medium text-m-ink-2 hover:border-m-sage/30 hover:text-m-sage transition-colors"
              >
                导出 PDF
              </button>
              <button
                onClick={handleExportWord}
                disabled={wordExporting}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-medium transition-colors ${
                  wordExporting
                    ? "cursor-wait border-black/8 text-m-ink-4"
                    : "border-black/10 bg-white/60 text-m-ink-2 hover:border-m-sage/30 hover:text-m-sage"
                }`}
              >
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
                <div className="relative flex size-14 items-center justify-center">
                  <div className="absolute inset-0 animate-ping rounded-full border border-m-sage/25" />
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-m-sage/20 border-t-m-sage" />
                </div>
                <p className="text-xs font-medium text-m-sage/70 animate-pulse">{progressLabel}</p>
              </div>
            )}

            {/* 错误 */}
            {status === "error" && (
              <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-2xl border border-red-400/18 bg-red-50/60 p-6 text-center">
                <span className="text-2xl">⚠️</span>
                <p className="text-sm font-medium text-red-600">{errorMsg}</p>
                <p className="text-[10px] text-m-ink-3">请检查内容是否完整，或稍后重试</p>
              </div>
            )}

            {/* 结果 */}
            {status === "done" && result && (
              <div className="w-full max-w-2xl flex flex-col gap-4">

                {/* 分数仪表（含情绪兜底） */}
                <ScoreGauge
                  score={result.total_score}
                  vectorScore={result.vector_score}
                />

                {/* 加权评估矩阵 */}
                {result.weight_matrix.length > 0 && (
                  <WeightMatrixPanel matrix={result.weight_matrix} />
                )}

                {/* 缺失技能警报 */}
                {result.missing_skills.length > 0 && (
                  <div className="flex flex-wrap gap-2 px-1">
                    {result.missing_skills.map((skill, i) => (
                      <span
                        key={i}
                        className="flex items-center gap-1 rounded-full border border-red-400/35 bg-red-50/70 px-3 py-0.5 text-[11px] font-medium text-red-500"
                      >
                        <span className="animate-pulse">⚠</span>
                        缺失：{skill}
                      </span>
                    ))}
                  </div>
                )}

                {/* Diff 分隔 */}
                {result.refine_advice.length > 0 && (
                  <>
                    <div className="flex items-center gap-3 px-1">
                      <div className="h-px flex-1 bg-black/6" />
                      <span className="text-[10px] font-medium text-m-ink-3">
                        {result.refine_advice.length} 处靶向润色建议
                      </span>
                      <div className="h-px flex-1 bg-black/6" />
                    </div>
                    {result.refine_advice.map((item, i) => (
                      <DiffCard key={i} item={item} index={i} />
                    ))}
                  </>
                )}

                {result.refine_advice.length === 0 && (
                  <p className="text-center text-sm text-m-ink-3">
                    AI 未返回具体润色建议，请检查简历内容后重试
                  </p>
                )}

                {/* 下一步：生成自我介绍 */}
                <div className="flex items-center gap-3 py-1">
                  <div className="h-px flex-1 bg-m-mauve/15" />
                  <span className="text-[10px] font-medium text-m-mauve/50">下一步</span>
                  <div className="h-px flex-1 bg-m-mauve/15" />
                </div>

                <button
                  type="button"
                  onClick={handleGenerateIntro}
                  disabled={isGeneratingIntro}
                  className={`flex w-full items-center justify-center gap-2.5 rounded-2xl border py-3 text-sm font-medium uppercase tracking-widest transition-all ${
                    isGeneratingIntro
                      ? "cursor-wait border-m-mauve/15 text-m-mauve/35"
                      : "border-m-mauve/28 text-m-mauve/80 hover:border-m-mauve/50 hover:bg-m-mauve/6"
                  }`}
                >
                  {isGeneratingIntro ? (
                    <>
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-m-mauve/20 border-t-m-mauve" />
                      生成中…
                    </>
                  ) : "🎙 生成面试自我介绍"}
                </button>

                {introError && (
                  <p className="text-center text-[10px] font-medium text-red-500">⚠ {introError}</p>
                )}
                {introData && (
                  <SelfIntroPanel data={introData} onClose={() => setIntroData(null)} />
                )}
              </div>
            )}

            {/* 空状态 */}
            {status === "idle" && (
              <div className="mt-16 flex flex-col items-center gap-4 text-center">
                <div className="flex size-16 items-center justify-center rounded-2xl border border-m-sage/18 bg-m-sage/6">
                  <span className="text-2xl text-m-sage/40">◈</span>
                </div>
                <p className="text-sm font-medium text-m-ink-2">在左侧填入简历与 JD</p>
                <p className="text-[11px] text-m-ink-4 max-w-xs leading-relaxed">
                  AI 将使用三级加权矩阵计算匹配分，并逐句输出靶向 Diff 润色结果
                </p>
                <div className="flex items-center gap-2 mt-2">
                  {[
                    { label: "核心项 W=1.0", color: "text-m-mauve" },
                    { label: "加分项 W=0.6", color: "text-m-sage" },
                    { label: "了解项 W=0.3", color: "text-m-slate" },
                  ].map((tag) => (
                    <span key={tag.label} className={`text-[10px] font-medium ${tag.color} glass-pill rounded-full px-2.5 py-0.5`}>
                      {tag.label}
                    </span>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

    </div>
  );
}
