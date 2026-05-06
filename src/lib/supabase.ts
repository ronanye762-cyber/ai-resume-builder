import { createBrowserClient } from '@supabase/ssr';

// 惰性单例：避免 build 时因 env 缺失而崩溃
// 使用 createBrowserClient（@supabase/ssr），session 自动写入 cookie
// 保证服务端 proxy.ts 与浏览器共享同一个登录态
let _client: ReturnType<typeof createBrowserClient> | null = null;

function getClient() {
  if (_client) return _client;
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  _client = createBrowserClient(url, anon);
  return _client;
}

/** 浏览器端单例（session 写 cookie，与 SSR proxy 共享登录态） */
export const supabase = new Proxy({} as ReturnType<typeof createBrowserClient>, {
  get(_t, prop) {
    return getClient()[prop as keyof ReturnType<typeof createBrowserClient>];
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
