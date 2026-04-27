import { createClient } from '@supabase/supabase-js';

// 惰性单例：避免 build 时因 env 缺失而崩溃
let _client: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (_client) return _client;
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  _client = createClient(url, anon);
  return _client;
}

/** 浏览器端单例（带 RLS，使用当前登录用户的权限） */
export const supabase = new Proxy({} as ReturnType<typeof createClient>, {
  get(_t, prop) {
    return getClient()[prop as keyof ReturnType<typeof createClient>];
  },
});

/** 数据库行类型 */
export type Assessment = {
  id: string;
  user_id: string;
  job_description: string;
  evaluation_result: Record<string, unknown>;
  created_at: string;
};
