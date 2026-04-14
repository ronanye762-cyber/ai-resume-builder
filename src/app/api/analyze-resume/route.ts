import { ZhipuAI } from "zhipuai";

// ── 对外导出类型（前端共享） ───────────────────────────────────

export type ProgressMsg = {
  type: "progress";
  label: string;
};

export type PolishedItem = {
  original_text: string;
  polished_text: string;
  reason: string;
};

export type ResultMsg = {
  type: "result";
  score: number;           // 余弦相似度映射的客观分数
  global_advice: string;
  polished_items: PolishedItem[];
  jd_missing_gap: string[];
};

export type ErrorMsg = { type: "error"; message: string };
export type PipelineMsg = ProgressMsg | ResultMsg | ErrorMsg;

// ── 智谱客户端 ────────────────────────────────────────────────
const client = new ZhipuAI({ apiKey: process.env.ZHIPU_API_KEY });

// ── 数学工具：余弦相似度 ──────────────────────────────────────
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] ** 2;
    normB += vecB[i] ** 2;
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── 向量相似度 → 分段灰度映射（移植自小程序 vectorMatch）────
// 比线性映射更合理：低分段更敏感、高分段更精确
//   sim < 0.45            → 0
//   0.45 ≤ sim < 0.65     → 20~59（线性插值）
//   0.65 ≤ sim < 0.85     → 60~89
//   sim ≥ 0.85            → 90~100
function mapSimilarityToScore(sim: number): number {
  if (sim < 0.45) return 0;
  if (sim < 0.65) return Math.round(20 + ((sim - 0.45) / 0.20) * 39);
  if (sim < 0.85) return Math.round(60 + ((sim - 0.65) / 0.20) * 29);
  return Math.round(Math.min(90 + ((sim - 0.85) / 0.15) * 10, 100));
}

// ── 向量化：调用 embedding-2 ──────────────────────────────────
async function getEmbedding(text: string): Promise<number[]> {
  const res = await client.embeddings.create({
    model: "embedding-2",
    input: text.slice(0, 3000), // embedding-2 单次上限
  });
  return res.data[0].embedding;
}

// ── 暴力 JSON 解析（三层兜底）────────────────────────────────
// GLM-4 实测两类致命错误：
//   1. JSON 字符串值内含裸换行 \u000A（非合法 \n 转义）
//   2. 中文内容里的英文双引号未被转义，破坏字符串边界
function robustJSONParse(raw: string): Record<string, unknown> | null {
  // Pass-1：直接 parse
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { /* continue */ }

  // 截取 { ... } 范围
  const first = raw.indexOf("{");
  const last  = raw.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  const block = raw.slice(first, last + 1);

  // Pass-2：清除控制字符（换行/回车/制表符 → 空格，其余直接删除）
  const noCtrl = block.replace(/[\u0000-\u001F]/g, (ch) =>
    ch === "\n" || ch === "\r" || ch === "\t" ? " " : "",
  );
  try { return JSON.parse(noCtrl) as Record<string, unknown>; } catch { /* continue */ }

  // Pass-3：逐字符扫描，修复字符串内的裸双引号
  try {
    let inStr = false;
    let escaped = false;
    let out = "";
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

// ── System Prompt ──────────────────────────────────────────────
const SYSTEM_PROMPT = `角色设定：前 BAT 级别资深技术 HR 及猎头，拥有 10 年招聘经验。
任务：根据用户提供的目标岗位 JD，靶向重构原始简历，并使用加权评分矩阵计算关键词匹配分。

【第一步：加权评分矩阵计算 keyword_score】
识别 JD 中每项要求的权重级别：
  高权重(3分)：包含"必须/精通/核心/X年以上/深度"等词
  中权重(2分)：包含"熟悉/掌握/具备/能够"等词
  低权重(1分)：包含"了解/优先考虑/加分项/最好有"等词
对照简历，评估每项 JD 要求的满足程度：
  完全命中 → 该项得满分（权重分）
  部分命中 → 该项得 50% 分
  未命中   → 该项得 0 分
计算公式：keyword_score = ROUND( 简历命中总分 / JD权重总分 × 100 )，结果为 0~100 整数。

【第二步：靶向润色 polished_items】
运用 STAR 法则重写经历，将大白话转化为带有数据支撑的专业表述，并自然植入 JD 关键词。
严禁凭空虚构任何公司、项目名或核心技术，仅做表达方式的升维。

【输出严格要求】
- polished_items 每个对象必须含 "original_text"、"polished_text"、"reason" 三字段。
- 所有字符串值不得含双引号字符（"），改用【】或『』。
- 字符串值不得含字面换行符，分行用 \\n。
- 不得含任何 Markdown 标记。

!!! 只能输出合法的、可直接被 JSON.parse() 解析的 JSON 字符串，严禁 markdown 标记和解释性文字 !!!

输出格式：
{
  "keyword_score": 75,
  "global_advice": "100字以内的整体评价",
  "polished_items": [
    {
      "original_text": "原始简历中的某句话",
      "polished_text": "润色后的专业表述",
      "reason": "修改原因说明"
    }
  ],
  "jd_missing_gap": ["缺失技能1", "缺失技能2"]
}`;

// ── LLM 润色（单独封装，供 Promise.all 并发调用）─────────────
async function getLLMPolishedData(resumeText: string, jdText: string): Promise<Record<string, unknown>> {
  const result = await client.chat.completions.create({
    model: "glm-4-plus",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `【简历原文】\n${resumeText.slice(0, 3000)}\n\n【目标岗位 JD】\n${jdText.slice(0, 2000)}`,
      },
    ],
    max_tokens: 3000,
    stream: false,
  });

  const raw =
    (result as unknown as { choices: { message: { content: string } }[] })
      .choices[0]?.message?.content ?? "{}";

  console.log("=== RAW LLM OUTPUT ===\n", raw, "\n=== END ===");

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
          jdText = (body.jdText ?? "").trim();
        } catch {
          controller.enqueue(line({ type: "error", message: "请求体解析失败，需要 JSON 格式" }));
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

        controller.enqueue(line({ type: "progress", label: "并发执行：AI 靶向润色 + 双向量余弦计算…" }));

        // ── 并发：LLM 润色 + 简历向量 + JD 向量 同时发起 ──────
        const [parsed, resumeVec, jdVec] = await Promise.all([
          getLLMPolishedData(resumeText, jdText),

          // embedding 失败时 fallback null，不阻断主流程
          getEmbedding(resumeText).catch((e) => {
            console.warn("简历向量化失败:", e);
            return null;
          }),
          getEmbedding(jdText).catch((e) => {
            console.warn("JD 向量化失败:", e);
            return null;
          }),
        ]);

        // ── 双引擎打分融合 ─────────────────────────────────────
        // 引擎 A：向量灰度分（余弦相似度 → 分段映射）
        // 引擎 B：关键词加权分（LLM 加权矩阵计算，来自 parsed.keyword_score）
        // 最终分 = A × 50% + B × 50%

        const keywordScore =
          typeof parsed.keyword_score === "number" &&
          parsed.keyword_score >= 0 &&
          parsed.keyword_score <= 100
            ? Math.round(parsed.keyword_score)
            : null;

        let score: number;
        if (resumeVec && jdVec) {
          const similarity = cosineSimilarity(resumeVec, jdVec);
          const vectorScore = mapSimilarityToScore(similarity);
          const kw = keywordScore ?? vectorScore; // keyword 缺失时用向量分代替
          score = Math.round(vectorScore * 0.5 + kw * 0.5);
          console.log(
            `余弦相似度: ${similarity.toFixed(4)} → 向量灰度分: ${vectorScore}`,
            `关键词加权分: ${keywordScore ?? "N/A"} → 融合分: ${score}`,
          );
        } else if (keywordScore !== null) {
          // 向量化失败：仅使用关键词分
          score = keywordScore;
          console.warn("向量化失败，使用关键词加权分:", score);
        } else {
          score = 50;
          console.warn("双引擎均失败，使用 fallback 分数 50");
        }

        // ── 组装结果 ───────────────────────────────────────────
        const polishedItems: PolishedItem[] = Array.isArray(parsed.polished_items)
          ? (parsed.polished_items as PolishedItem[]).filter(
              (item) =>
                item &&
                typeof item.original_text === "string" &&
                typeof item.polished_text === "string",
            )
          : [];

        controller.enqueue(
          line({
            type: "result",
            score,
            global_advice: typeof parsed.global_advice === "string" ? parsed.global_advice : "",
            polished_items: polishedItems,
            jd_missing_gap: Array.isArray(parsed.jd_missing_gap)
              ? (parsed.jd_missing_gap as string[]).filter((s) => typeof s === "string")
              : [],
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
