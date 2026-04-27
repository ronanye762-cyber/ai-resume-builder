import { ZhipuAI } from "zhipuai";

export type TranslatedJd = {
  real_duty: string;
  hard_requirements: string[];
  nice_to_have: string[];
  toxic_comment: string;
};

let _c: ZhipuAI | null = null;
function getClient() { if (!_c) _c = new ZhipuAI({ apiKey: process.env.ZHIPU_API_KEY ?? '' }); return _c; }
const client = new Proxy({} as ZhipuAI, { get(_t, p) { return getClient()[p as keyof ZhipuAI]; } });

// ── 暴力 JSON 解析（与 analyze-resume 同款三层兜底）────────────
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

// ── System Prompt（毒舌业务总监人设）──────────────────────────
const SYSTEM_PROMPT = `你是一个厌恶职场黑话、性格有些毒舌但在大厂阅人无数的资深业务总监。
你的任务是把 HR 写的那些虚头巴脑的岗位描述（JD）翻译成通俗易懂的大白话。

输出严格要求：
- 所有字符串值不得含双引号字符（"），改用【】表达引用。
- 字符串值不得含字面换行符，用空格分隔即可。
- 不得含任何 Markdown 标记或解释性前缀。

!!! 只能输出合法的、可直接被 JSON.parse() 解析的 JSON，严禁任何 markdown 和解释文字 !!!

必须严格按以下格式输出：
{
  "real_duty": "用最接地气的话解释这个岗位每天的具体工作，说人话，不超过80字",
  "hard_requirements": ["剥离废话后的核心硬性门槛1", "核心硬性门槛2", "核心硬性门槛3"],
  "nice_to_have": ["加分项1", "加分项2"],
  "toxic_comment": "用一句犀利、幽默的话点评这个岗位的坑或者亮点，可以稍微毒一点"
}`;

// ── POST /api/translate-jd ────────────────────────────────────
// Body: { jdText: string }
// Response: { data: TranslatedJd } | { error: string }
export async function POST(req: Request) {
  let jdText: string;
  try {
    const body = await req.json() as { jdText?: string };
    jdText = (body.jdText ?? "").trim();
  } catch {
    return Response.json({ error: "请求体解析失败" }, { status: 400 });
  }

  if (!jdText || jdText.length < 10) {
    return Response.json({ error: "JD 内容不能为空" }, { status: 400 });
  }

  try {
    const result = await client.chat.completions.create({
      model: "glm-4-plus",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `请翻译以下岗位 JD：\n\n${jdText.slice(0, 3000)}` },
      ],
      max_tokens: 1000,
      stream: false,
    });

    const raw =
      (result as unknown as { choices: { message: { content: string } }[] })
        .choices[0]?.message?.content ?? "{}";

    const parsed = robustJSONParse(raw);
    if (!parsed) {
      return Response.json({ error: "AI 返回格式解析失败，请重试" }, { status: 500 });
    }

    const data: TranslatedJd = {
      real_duty:
        typeof parsed.real_duty === "string" ? parsed.real_duty : "解析失败，请重试",
      hard_requirements: Array.isArray(parsed.hard_requirements)
        ? (parsed.hard_requirements as string[]).filter((s) => typeof s === "string")
        : [],
      nice_to_have: Array.isArray(parsed.nice_to_have)
        ? (parsed.nice_to_have as string[]).filter((s) => typeof s === "string")
        : [],
      toxic_comment:
        typeof parsed.toxic_comment === "string" ? parsed.toxic_comment : "",
    };

    return Response.json({ data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "服务器内部错误";
    return Response.json({ error: msg }, { status: 500 });
  }
}
