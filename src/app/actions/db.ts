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

/**
 * 行为事件入库（与 Vercel Analytics track() 并行，数据留在自己库）
 * 静默执行，失败不影响 UI
 */
export async function trackEvent(
  eventName: string,
  properties: Record<string, string | number> = {},
): Promise<void> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('events').insert({
      user_id:    user.id,
      event_name: eventName,
      properties,
    });
  } catch {
    // 静默失败
  }
}

const PAGE_SIZE = 20;

export async function fetchMoreAssessments(offset: number) {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from('assessments')
      .select('id, job_description, evaluation_result, created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    return data ?? [];
  } catch {
    return [];
  }
}

export async function fetchMoreResumes(offset: number) {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from('generated_resumes')
      .select('id, final_content, created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    return data ?? [];
  } catch {
    return [];
  }
}
