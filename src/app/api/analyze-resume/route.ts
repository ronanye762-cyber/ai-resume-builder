import { ZhipuAI } from "zhipuai";

// ── 对外导出类型 ──────────────────────────────────────────────

export type ProgressMsg = {
  type: "progress";
  label: string;
};

/** 加权矩阵中的单项条目 */
export type WeightMatrixItem = {
  keyword: string;
  category: "core" | "bonus" | "awareness";
  weight: 1.0 | 0.6 | 0.3;
  score: number; // 0-100：简历对该项的满足度
};

/** 靶向润色建议单条 */
export type RefineAdviceItem = {
  original_text: string;
  polished_text: string;
  reason: string;
};

export type ResultMsg = {
  type: "result";
  total_score: number;            // 加权公式计算结果
  vector_score: number | null;    // 余弦向量辅助分（可为 null）
  weight_matrix: WeightMatrixItem[];
  missing_skills: string[];
  refine_advice: RefineAdviceItem[];
  // 向后兼容字段（旧 PolishingView 使用）
  score: number;
  global_advice: string;
  polished_items: RefineAdviceItem[];
  jd_missing_gap: string[];
};

export type ErrorMsg = { type: "error"; message: string };
export type PipelineMsg = ProgressMsg | ResultMsg | ErrorMsg;

// ── 向后兼容别名（旧 PolishingView 仍在使用）─────────────────
/** @deprecated 请改用 RefineAdviceItem */
export type PolishedItem = RefineAdviceItem;

// ── 智谱客户端 ────────────────────────────────────────────────
const client = new ZhipuAI({ apiKey: process.env.ZHIPU_API_KEY });

// ── 加权公式：Score = Σ(Wi × Si) / Σ(Wi) ─────────────────────
// 核心项 W=1.0 | 加分项 W=0.6 | 了解项 W=0.3
const WEIGHT_MAP: Record<WeightMatrixItem["category"], number> = {
  core:      1.0,
  bonus:     0.6,
  awareness: 0.3,
};

function computeWeightedScore(matrix: WeightMatrixItem[]): number {
  if (!matrix || matrix.length === 0) return 0;
  let sumWS = 0;
  let sumW  = 0;
  for (const item of matrix) {
    const w = WEIGHT_MAP[item.category] ?? item.weight;
    sumWS += w * Math.max(0, Math.min(100, item.score));
    sumW  += w;
  }
  return sumW > 0 ? Math.round(sumWS / sumW) : 0;
}

// ── 向量化与余弦相似度 ────────────────────────────────────────
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot   += vecA[i] * vecB[i];
    normA += vecA[i] ** 2;
    normB += vecB[i] ** 2;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function mapSimilarityToScore(sim: number): number {
  if (sim < 0.45) return 0;
  if (sim < 0.65) return Math.round(20 + ((sim - 0.45) / 0.20) * 39);
  if (sim < 0.85) return Math.round(60 + ((sim - 0.65) / 0.20) * 29);
  return Math.round(Math.min(90 + ((sim - 0.85) / 0.15) * 10, 100));
}

async function getEmbedding(text: string): Promise<number[]> {
  const res = await client.embeddings.create({
    model: "embedding-2",
    input: text.slice(0, 3000),
  });
  return res.data[0].embedding;
}

// ── 三层 JSON 兜底解析 ────────────────────────────────────────
function robustJSONParse(raw: string): Record<string, unknown> | null {
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { /* continue */ }

  const first = raw.indexOf("{");
  const last  = raw.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  const block = raw.slice(first, last + 1);

  const noCtrl = block.replace(/[\u0000-\u001F]/g, (ch) =>
    ch === "\n" || ch === "\r" || ch === "\t" ? " " : "",
  );
  try { return JSON.parse(noCtrl) as Record<string, unknown>; } catch { /* continue */ }

  try {
    let inStr = false, escaped = false, out = "";
    for (let i = 0; i < noCtrl.length; i++) {
      const ch = noCtrl[i];
      if (escaped) { out += ch; escaped = false; continue; }
      if (ch === "\\") { out += ch; escaped = true; continue; }
      if (ch === '"') {
        if (!inStr) { inStr = true; out += ch; continue; }
        let j = i + 1;
        while (j < noCtrl.length && noCtrl[j] === " ") j++;
        const next = noCtrl[j];
        if (!next || next === "," || next === "}" || next === "]" || next === ":") {
          inStr = false; out += ch;
        } else {
          out += '\\"';
        }
        continue;
      }
      out += ch;
    }
    return JSON.parse(out) as Record<string, unknown>;
  } catch { return null; }
}

// ── System Prompt：三级加权评估矩阵 ──────────────────────────
const SYSTEM_PROMPT = `你是前 BAT 资深技术 HR，拥有 10 年大厂招聘经验。
任务：分析简历与 JD 的匹配情况，输出加权评估矩阵报告与靶向润色建议。

════════════════════════════════════════
【第一步：三级加权评估矩阵】
════════════════════════════════════════

按以下规则识别 JD 中每项能力要求，划分权重等级：

- 核心项（category: "core"，weight: 1.0）
  关键词：必须 / 精通 / X年以上 / 核心 / 深度 / 主导 / 负责 / 独立完成
  含义：不满足此项通常直接拒绝，是硬性门槛

- 加分项（category: "bonus"，weight: 0.6）
  关键词：熟悉 / 掌握 / 具备 / 有经验 / 能够 / 了解并实践
  含义：有则加分，增强竞争力

- 了解项（category: "awareness"，weight: 0.3）
  关键词：了解 / 优先 / 最好有 / 加分项 / 有意愿 / 能接受学习
  含义：锦上添花项，有更好

对照简历，为每项要求评定满足度 score（0-100）：
- 完全匹配，有明确数据支撑 → 80-100
- 有相关经历但不完全精确 → 40-70
- 几乎无相关经历 → 0-30

【加权公式（服务端复验用）】
total_score = ROUND( Σ(weight_i × score_i) / Σ(weight_i) )

════════════════════════════════════════
【第二步：靶向润色建议】
════════════════════════════════════════

运用 STAR 法则重写简历中与 JD 最相关的句子，植入关键词，补充量化数据。
严禁凭空虚构任何公司名、项目名、技术细节或数字。
每条 refine_advice 必须有清晰的修改理由。

════════════════════════════════════════
【输出严格约束】
════════════════════════════════════════

1. 只能输出合法 JSON，不得有任何 markdown 代码块、前缀或解释文字
2. 所有字符串值不得含双引号字符（"），改用【】
3. 字符串值不得含字面换行符，换行用 \\n 转义
4. weight 字段必须是数字 1.0 / 0.6 / 0.3，不得是字符串
5. score 字段必须是 0-100 的整数

!!! 开头直接输出 {，不得有任何其他字符 !!!

输出格式：
{
  "weight_matrix": [
    {"keyword": "React", "category": "core", "weight": 1.0, "score": 85},
    {"keyword": "TypeScript", "category": "bonus", "weight": 0.6, "score": 70},
    {"keyword": "Docker", "category": "awareness", "weight": 0.3, "score": 0}
  ],
  "missing_skills": ["Docker", "Kubernetes"],
  "refine_advice": [
    {
      "original_text": "负责前端开发",
      "polished_text": "主导 React+TypeScript 前端模块开发，实现动态数据看板，日均 UV 提升 40%",
      "reason": "补充技术栈细节与量化指标，符合 JD 中【核心项：React 精通】的要求"
    }
  ]
}`;

// ── LLM 调用 ─────────────────────────────────────────────────
async function callLLM(resumeText: string, jdText: string): Promise<Record<string, unknown>> {
  const result = await client.chat.completions.create({
    model: "glm-4-plus",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `【简历原文】\n${resumeText.slice(0, 3000)}\n\n【目标岗位 JD】\n${jdText.slice(0, 2000)}`,
      },
    ],
    max_tokens: 3500,
    stream: false,
  });

  const raw =
    (result as unknown as { choices: { message: { content: string } }[] })
      .choices[0]?.message?.content ?? "{}";

  console.log("=== LLM RAW OUTPUT ===\n", raw.slice(0, 300), "\n...");

  const parsed = robustJSONParse(raw);
  if (!parsed) throw new Error("AI 返回 JSON 解析失败，请重试");
  return parsed;
}

// ── POST /api/analyze-resume ──────────────────────────────────
// Body (JSON): { resumeText: string, jdText: string }
// Response: NDJSON stream of PipelineMsg
export async function POST(req: Request) {
  const encoder = new TextEncoder();
  const line = (msg: PipelineMsg) => encoder.encode(JSON.stringify(msg) + "\n");

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let resumeText: string, jdText: string;
        try {
          const body = await req.json() as { resumeText?: string; jdText?: string };
          resumeText = (body.resumeText ?? "").trim();
          jdText     = (body.jdText ?? "").trim();
        } catch {
          controller.enqueue(line({ type: "error", message: "请求体解析失败" }));
          return;
        }

        if (!resumeText) {
          controller.enqueue(line({ type: "error", message: "简历内容不能为空" }));
          return;
        }
        if (!jdText) {
          controller.enqueue(line({ type: "error", message: "JD 内容不能为空" }));
          return;
        }

        controller.enqueue(line({ type: "progress", label: "AI 加权矩阵分析 + 余弦向量计算并发执行…" }));

        // 并发：LLM 分析 + 双向量
        const [parsed, resumeVec, jdVec] = await Promise.all([
          callLLM(resumeText, jdText),
          getEmbedding(resumeText).catch((e) => { console.warn("简历向量化失败:", e); return null; }),
          getEmbedding(jdText).catch((e)     => { console.warn("JD 向量化失败:", e);   return null; }),
        ]);

        // ── 提取并校验 weight_matrix ──────────────────────────
        const rawMatrix = Array.isArray(parsed.weight_matrix)
          ? (parsed.weight_matrix as unknown[])
          : [];

        const weightMatrix: WeightMatrixItem[] = rawMatrix
          .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
          .map((item) => {
            const cat = (item.category as string) ?? "core";
            const validCat: WeightMatrixItem["category"] =
              cat === "bonus" ? "bonus" : cat === "awareness" ? "awareness" : "core";
            return {
              keyword:  typeof item.keyword === "string" ? item.keyword : "未知技能",
              category: validCat,
              weight:   WEIGHT_MAP[validCat] as WeightMatrixItem["weight"],
              score:    typeof item.score === "number"
                ? Math.max(0, Math.min(100, Math.round(item.score)))
                : 0,
            };
          });

        // ── 加权公式计算主分 ──────────────────────────────────
        const weightedScore = computeWeightedScore(weightMatrix);

        // ── 向量辅助分（余弦相似度映射） ──────────────────────
        let vectorScore: number | null = null;
        if (resumeVec && jdVec) {
          const sim = cosineSimilarity(resumeVec, jdVec);
          vectorScore = mapSimilarityToScore(sim);
          console.log(`余弦相似度: ${sim.toFixed(4)} → 向量分: ${vectorScore}, 加权分: ${weightedScore}`);
        }

        // ── 最终分 = 加权矩阵分（主）+ 向量分（参考，不影响主分）
        const totalScore = weightedScore;

        // ── 靶向润色建议 ───────────────────────────────────────
        const refineAdvice: RefineAdviceItem[] = Array.isArray(parsed.refine_advice)
          ? (parsed.refine_advice as RefineAdviceItem[]).filter(
              (item) =>
                item &&
                typeof item.original_text === "string" &&
                typeof item.polished_text === "string",
            )
          : [];

        const missingSkills: string[] = Array.isArray(parsed.missing_skills)
          ? (parsed.missing_skills as string[]).filter((s) => typeof s === "string")
          : [];

        controller.enqueue(
          line({
            type:          "result",
            total_score:   totalScore,
            vector_score:  vectorScore,
            weight_matrix: weightMatrix,
            missing_skills: missingSkills,
            refine_advice:  refineAdvice,
            // 向后兼容字段
            score:          totalScore,
            global_advice:  typeof parsed.global_advice === "string" ? parsed.global_advice : "",
            polished_items: refineAdvice,
            jd_missing_gap: missingSkills,
          }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "服务器内部错误";
        controller.enqueue(line({ type: "error", message: msg }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-cache",
    },
  });
}
