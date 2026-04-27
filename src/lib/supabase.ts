import { createClient } from '@supabase/supabase-js';

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnon) {
  throw new Error(
    '缺少 Supabase 环境变量，请在 .env.local 中配置 ' +
    'NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_ANON_KEY'
  );
}

/** 浏览器端单例（带 RLS，使用当前登录用户的权限） */
export const supabase = createClient(supabaseUrl, supabaseAnon);

/** 数据库行类型 */
export type Assessment = {
  id: string;
  user_id: string;
  job_description: string;
  evaluation_result: Record<string, unknown>;
  created_at: string;
};
