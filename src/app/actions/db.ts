'use server';

import { createClient } from '@/lib/supabase-server';
import type { ResultMsg } from '@/app/api/analyze-resume/route';

/**
 * /match 页面：评估报告入库
 * 静默执行，失败不影响 UI 渲染
 */
export async function saveAssessment(
  jdText: string,
  result: ResultMsg,
): Promise<void> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return; // 未登录静默跳过

    const { error } = await supabase.from('assessments').insert({
      user_id:           user.id,
      job_description:   jdText.slice(0, 4000), // 截断防超限
      evaluation_result: result as unknown as Record<string, unknown>,
    });

    if (error) throw error;
  } catch (e) {
    console.warn('[saveAssessment] 入库失败（不影响使用）:', e);
  }
}

/**
 * /chat 页面：生成简历入库
 * 静默执行，失败不影响 UI 渲染
 */
export async function saveGeneratedResume(
  finalContent: string,
): Promise<void> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from('generated_resumes').insert({
      user_id:       user.id,
      final_content: finalContent,
    });

    if (error) throw error;
  } catch (e) {
    console.warn('[saveGeneratedResume] 入库失败（不影响使用）:', e);
  }
}
