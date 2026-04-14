import { ZhipuAI } from "zhipuai";

export type SelfIntroData = {
  hook: string;
  past_experience: string;
  future_value: string;
  coach_tips: string[];
};

const client = new ZhipuAI({ apiKey: process.env.ZHIPU_API_KEY });

// ── 暴力 JSON 解析（三层兜底）────────────────────────────────
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

// ── System Prompt（20年面试教练人设）──────────────────────────
const SYSTEM_PROMPT = `你是一位拥有 20 年大厂经验的顶级面试教练，见过无数简历，送过无数候选人进大厂。
你的任务是根据用户的简历和目标岗位 JD，为用户定制一份 300-400 字（约 1.5 分钟口语语速）的面试自我介绍。

要求：
1. 采用高转化率的【现在-过去-未来】三段式结构。
2. 绝对口语化！严禁出现【本人】【参与了 xxx 链路打通】【赋能】【沉淀】等书面黑话和职场黑话，要像对面试官自然聊天一样自信、流畅。
3. 数字和成果要具体，从简历中提取真实数据，不要虚构。
4. 每段控制在 100-130 字，整体流畅连贯，不要像在背稿子。

输出严格要求：
- 所有字符串值不得含双引号字符（"），改用【】表达引用。
- 字符串值不得含字面换行符，段落用空格自然衔接即可。
- 不得含任何 Markdown 标记或解释性文字。

!!! 只能输出合法的、可直接被 JSON.parse() 解析的 JSON，严禁 markdown 和解释文字 !!!

必须严格按以下格式输出：
{
  "hook": "【现在-开场破冰】一句话破冰：核心身份 + 与岗位的契合点，抓住面试官注意力，不超过 60 字",
  "past_experience": "【过去-高光重塑】挑选简历中与 JD 最匹配的 1-2 段高光经历，用口语化 STAR 法讲成故事，带数据，100-130 字",
  "future_value": "【未来-价值传递】为什么选这家公司？进来后能带来什么价值？自然收尾不卑不亢，80-100 字",
  "coach_tips": ["教练私房建议，如：讲这段时语速放慢，眼神坚定", "另一条教练建议"]
}`;

// ── POST /api/self-intro ──────────────────────────────────────
// Body: { resumeText: string, jdText: string }
export async function POST(req: Request) {
  let resumeText: string, jdText: string;
  try {
    const body = await req.json() as { resumeText?: string; jdText?: string };
    resumeText = (body.resumeText ?? "").trim();
    jdText     = (body.jdText ?? "").trim();
  } catch {
    return Response.json({ error: "请求体解析失败" }, { status: 400 });
  }

  if (!resumeText || resumeText.length < 10) {
    return Response.json({ error: "简历内容不能为空" }, { status: 400 });
  }
  if (!jdText || jdText.length < 10) {
    return Response.json({ error: "JD 内容不能为空" }, { status: 400 });
  }

  try {
    const result = await client.chat.completions.create({
      model: "glm-4-plus",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `【简历内容】\n${resumeText.slice(0, 3000)}\n\n【目标岗位 JD】\n${jdText.slice(0, 1500)}`,
        },
      ],
      max_tokens: 1200,
      stream: false,
    });

    const raw =
      (result as unknown as { choices: { message: { content: string } }[] })
        .choices[0]?.message?.content ?? "{}";

    const parsed = robustJSONParse(raw);
    if (!parsed) {
      return Response.json({ error: "AI 返回格式解析失败，请重试" }, { status: 500 });
    }

    const data: SelfIntroData = {
      hook:
        typeof parsed.hook === "string" ? parsed.hook : "",
      past_experience:
        typeof parsed.past_experience === "string" ? parsed.past_experience : "",
      future_value:
        typeof parsed.future_value === "string" ? parsed.future_value : "",
      coach_tips: Array.isArray(parsed.coach_tips)
        ? (parsed.coach_tips as string[]).filter((s) => typeof s === "string")
        : [],
    };

    return Response.json({ data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "服务器内部错误";
    return Response.json({ error: msg }, { status: 500 });
  }
}
