import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import HistoryView from '@/components/HistoryView';

export const metadata = { title: '我的记录 · AI 简历引擎' };

export default async function HistoryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // 并发拉取两张表，各取最近 30 条
  const [{ data: assessments }, { data: generatedResumes }] = await Promise.all([
    supabase
      .from('assessments')
      .select('id, job_description, evaluation_result, created_at')
      .order('created_at', { ascending: false })
      .limit(30),
    supabase
      .from('generated_resumes')
      .select('id, final_content, created_at')
      .order('created_at', { ascending: false })
      .limit(30),
  ]);

  return (
    <HistoryView
      assessments={assessments ?? []}
      generatedResumes={generatedResumes ?? []}
      userEmail={user.email ?? ""}
    />
  );
}
