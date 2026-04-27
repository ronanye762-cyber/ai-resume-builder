import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'node:crypto';

// ── ZhipuAI REST 基础工具 ─────────────────────────────────────

const ZHIPU_BASE = 'https://open.bigmodel.cn/api/paas/v4';

/**
 * 用 node:crypto 自签智谱 JWT（无额外依赖）
 * Header: { alg: "HS256", sign_type: "SIGN" }
 * Payload: { api_key: <id>, exp: <now+1h>, timestamp: <now> }
 */
function generateJWT(apiKey: string): string {
  const dotIdx = apiKey.lastIndexOf('.');
  const id = apiKey.slice(0, dotIdx);
  const secret = apiKey.slice(dotIdx + 1);
  const now = Date.now();

  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', sign_type: 'SIGN' }),
  ).toString('base64url');

  const payload = Buffer.from(
    JSON.stringify({ api_key: id, exp: now + 3_600_000, timestamp: now }),
  ).toString('base64url');

  const sig = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${sig}`;
}

/** 带鉴权的 ZhipuAI fetch */
async function zhipuFetch(
  path: string,
  init: RequestInit & { headers?: Record<string, string> },
): Promise<Response> {
  const token = generateJWT(process.env.ZHIPU_API_KEY ?? '');
  return fetch(`${ZHIPU_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
  });
}

// ── PDF：File API (file-extract) → GET /files/{id}/content ───
//
// 智谱 file-extract 流程：
//   POST /v4/files  (purpose=file-extract)  → 上传
//   GET  /v4/files/{id}                     → 轮询状态
//   GET  /v4/files/{id}/content             → 直接拿提取文本
//   DELETE /v4/files/{id}                   → 异步清理
//
// 注意：glm-4-long 不接受 type:"file" 的 content，
//       file-extract 用途本身就是让智谱服务端提取文字，
//       无需再走 chat completions。

async function extractTextFromPDF(buffer: Buffer, fileName: string): Promise<string> {
  // Step 1：上传
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }), fileName);
  form.append('purpose', 'file-extract');

  const uploadRes = await zhipuFetch('/files', { method: 'POST', body: form });
  if (!uploadRes.ok) {
    const body = await uploadRes.text();
    throw new Error(`文件上传失败 [${uploadRes.status}]: ${body}`);
  }
  const { id: fileId } = (await uploadRes.json()) as { id: string; status?: string };

  // Step 2：轮询直到 success（最多 30 秒）
  for (let i = 0; i < 30; i++) {
    const s = (await (await zhipuFetch(`/files/${fileId}`, { method: 'GET' })).json()) as {
      id: string;
      status?: string;
    };
    if (!s.status || s.status === 'success') break;
    if (s.status === 'error') throw new Error('智谱文件处理失败');
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Step 3：取提取好的纯文本（智谱 file-extract 专用接口）
  const contentRes = await zhipuFetch(`/files/${fileId}/content`, { method: 'GET' });
  if (!contentRes.ok) {
    const body = await contentRes.text();
    throw new Error(`获取文件内容失败 [${contentRes.status}]: ${body}`);
  }
  const extracted = (await contentRes.json()) as { content?: string; text?: string };
  const text = (extracted.content ?? extracted.text ?? '').trim();

  // Step 4：异步删除（不阻塞响应）
  zhipuFetch(`/files/${fileId}`, { method: 'DELETE' }).catch(() => {});

  return text;
}

// ── 图片：GLM-4V + Base64 ─────────────────────────────────────
//
// 正确模型名：glm-4v（glm-4v-flash 不存在）
// content 必须是数组，image_url.url 携带 data:mime;base64 前缀

// 图片有效性门控错误标记
const INVALID_IMG_CODE = 'INVALID_IMAGE_CONTENT';

async function extractTextFromImage(buffer: Buffer, mimeType: string): Promise<string> {
  const safeMime = mimeType.startsWith('image/') ? mimeType : 'image/jpeg';
  const dataUrl = `data:${safeMime};base64,${buffer.toString('base64')}`;

  const chatRes = await zhipuFetch('/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'glm-4v',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `请完成以下两步任务，只输出 JSON，不得有任何其他文字：

Step 0【有效性检查】：判断图片是否包含简历或招聘 JD 相关文字内容。
- 无效类型（直接返回无效）：表情包、聊天界面截图、风景照、商品图、二维码、纯图形/图表、与简历/JD 完全无关的内容。
- 有效类型：包含姓名/联系方式/教育/工作/实习/项目/技能/职位要求/工作职责等文字的图片。

若无效，输出：{"is_valid":false,"error_code":"INVALID_IMAGE_CONTENT"}
若有效，提取全部文字后输出：{"is_valid":true,"text":"提取到的完整纯文本，段落之间用\\n分隔"}

【严格 JSON 格式要求 — 违反将导致系统崩溃】
1. 必须返回合法 JSON。开头直接输出 {，结尾是 }，不得有任何 Markdown 标记（如 \`\`\`json）
2. text 字段的值必须是极其扁平的纯文本字符串！绝对不允许在 text 内部出现任何 JSON 格式、对象 {}、数组 [] 或多余的双引号 "。将所有内容合并成一段话，只允许使用 \\n 进行换行转义
3. text 字段中绝对不能输出真实的换行符（即不能按回车键换行），只能用 \\n 转义符代替
4. 只输出一个 JSON 对象，不得有任何前缀或解释文字`,
            },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });

  if (!chatRes.ok) {
    const body = await chatRes.text();
    throw new Error(`GLM-4V OCR 失败 [${chatRes.status}]: ${body}`);
  }

  const data = (await chatRes.json()) as {
    choices: { message: { content: string } }[];
  };
  const raw = data.choices[0]?.message?.content?.trim() ?? '';

  // 解析 JSON 响应（GLM-4V 应输出 JSON，但偶尔会带 markdown / 不可见字符 / 直接输出纯文本）
  type OcrJson = { is_valid?: boolean; error_code?: string; text?: string };

  // 用正则直接从原始字符串中暴力提取第一个 { 到最后一个 } 的完整块
  // 不做任何 replace 预处理，避免因不可见字符导致的误判
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as OcrJson;

      // is_valid 明确为 false → 无效图片
      if (parsed.is_valid === false) {
        const err = new Error(INVALID_IMG_CODE);
        (err as Error & { error_code: string }).error_code = INVALID_IMG_CODE;
        throw err;
      }

      // 成功提取到 text 字段
      const text = (parsed.text ?? '').trim();
      if (text) return text;

      // JSON 合法但 text 字段为空 → 无效
      const err = new Error(INVALID_IMG_CODE);
      (err as Error & { error_code: string }).error_code = INVALID_IMG_CODE;
      throw err;

    } catch (e) {
      // 重新抛出业务错误（INVALID_IMAGE_CONTENT），不进入纯文本兜底
      if (e instanceof Error && (e as Error & { error_code?: string }).error_code === INVALID_IMG_CODE) throw e;

      // JSON 块损坏（诡异格式） → 打印完整日志供排查，回退到纯文本兜底
      console.error('[extract-text] JSON 解析失败，原始返回体:', raw, '\n解析错误:', e);
    }
  }

  // 未提取到 JSON 块，或 JSON 解析异常 → 模型直接返回了纯文本，接受并返回
  const plainText = raw.trim();
  if (plainText.length > 5) return plainText;

  // 什么内容都没有 → 无效
  const emptyErr = new Error(INVALID_IMG_CODE);
  (emptyErr as Error & { error_code: string }).error_code = INVALID_IMG_CODE;
  throw emptyErr;
}

// ── POST /api/extract-text ────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: '请上传文件' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = file.type;
    const fileName = file.name.toLowerCase();

    let text = '';

    if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) {
      text = await extractTextFromPDF(buffer, file.name);
    } else if (
      mimeType.startsWith('image/') ||
      /\.(jpe?g|png|webp|gif|bmp)$/.test(fileName)
    ) {
      text = await extractTextFromImage(buffer, mimeType);
    } else {
      return NextResponse.json(
        { error: '不支持的文件格式，请上传 PDF 或图片（JPG / PNG / WebP）' },
        { status: 400 },
      );
    }

    if (!text) {
      return NextResponse.json(
        { error: '未能从文件中提取到文字，请检查文件内容' },
        { status: 422 },
      );
    }

    return NextResponse.json({ text });

  } catch (error) {
    console.error('文件提取失败详情:', error);
    // 有效性门控：非简历/JD 图片
    if (
      error instanceof Error &&
      ((error as Error & { error_code?: string }).error_code === INVALID_IMG_CODE ||
        error.message === INVALID_IMG_CODE)
    ) {
      return NextResponse.json(
        {
          error: '请上传包含文字的简历或 JD 图片，不要上传无关图片哦',
          error_code: INVALID_IMG_CODE,
        },
        { status: 422 },
      );
    }
    return NextResponse.json({ error: '服务器内部解析失败' }, { status: 500 });
  }
}
