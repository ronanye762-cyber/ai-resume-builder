"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab]         = useState<"login" | "signup">("login");
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [notice, setNotice]   = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    if (tab === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message === "Invalid login credentials"
          ? "邮箱或密码错误，请重试"
          : error.message);
      } else {
        router.push("/history");
        router.refresh();
      }
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${location.origin}/auth/callback` },
      });
      if (error) {
        setError(error.message.includes("already registered")
          ? "该邮箱已注册，请直接登录"
          : error.message);
      } else {
        setNotice("注册成功！请前往邮箱点击确认链接后即可登录。");
        setEmail("");
        setPassword("");
      }
    }

    setLoading(false);
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">

      {/* 背景光晕 */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 left-1/3 h-80 w-80 rounded-full bg-m-mauve/10 blur-[100px]" />
        <div className="absolute bottom-0 right-1/3 h-72 w-72 rounded-full bg-m-sage/10 blur-[80px]" />
      </div>

      <div className="relative w-full max-w-sm">

        {/* Logo 区 */}
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full glass-pill px-4 py-1.5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-m-sage" />
            <span className="text-[11px] font-medium tracking-[0.18em] text-m-ink-2 uppercase">
              AI · 简历引擎
            </span>
          </div>
          <h1 className="text-2xl font-light text-m-ink tracking-tight">
            {tab === "login" ? "欢迎回来" : "创建账户"}
          </h1>
          <p className="mt-1.5 text-sm text-m-ink-3">
            {tab === "login" ? "登录后可保存评估报告与生成简历" : "注册即可永久保存你的 AI 简历档案"}
          </p>
        </div>

        {/* 卡片 */}
        <div className="rounded-3xl border border-black/6 bg-white/70 backdrop-blur-sm p-8 shadow-sm">

          {/* Tab */}
          <div className="mb-6 flex gap-1 rounded-xl border border-black/5 bg-black/3 p-1">
            {(["login", "signup"] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setError(null); setNotice(null); }}
                className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all duration-200 ${
                  tab === t
                    ? "bg-white shadow-sm text-m-ink border border-black/5"
                    : "text-m-ink-3 hover:text-m-ink"
                }`}
              >
                {t === "login" ? "登录" : "注册"}
              </button>
            ))}
          </div>

          {/* 表单 */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-widest text-m-ink-3">
                邮箱
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-black/8 bg-white/80 px-3.5 py-2.5 text-sm text-m-ink placeholder:text-m-ink-4/50 focus:outline-none focus:border-m-mauve/40 focus:ring-2 focus:ring-m-mauve/10 transition-all"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-widest text-m-ink-3">
                密码
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={tab === "signup" ? "至少 6 位" : "••••••••"}
                className="w-full rounded-xl border border-black/8 bg-white/80 px-3.5 py-2.5 text-sm text-m-ink placeholder:text-m-ink-4/50 focus:outline-none focus:border-m-mauve/40 focus:ring-2 focus:ring-m-mauve/10 transition-all"
              />
            </div>

            {/* 错误 / 成功提示 */}
            {error && (
              <p className="flex items-center gap-1.5 rounded-xl border border-red-400/20 bg-red-50/70 px-3 py-2 text-[12px] font-medium text-red-600">
                ⚠ {error}
              </p>
            )}
            {notice && (
              <p className="flex items-center gap-1.5 rounded-xl border border-m-sage/25 bg-m-sage/8 px-3 py-2 text-[12px] font-medium text-m-sage">
                ✓ {notice}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className={`mt-1 w-full rounded-xl border py-2.5 text-sm font-semibold uppercase tracking-wider transition-all ${
                loading
                  ? "cursor-wait border-black/8 text-m-ink-4"
                  : "border-m-mauve/35 bg-m-mauve/10 text-m-mauve hover:bg-m-mauve/18 shadow-sm"
              }`}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-m-mauve/20 border-t-m-mauve" />
                  {tab === "login" ? "登录中…" : "注册中…"}
                </span>
              ) : (
                tab === "login" ? "登录" : "注册"
              )}
            </button>
          </form>
        </div>

        {/* 返回首页 */}
        <p className="mt-6 text-center text-xs text-m-ink-4">
          <button
            onClick={() => router.push("/")}
            className="hover:text-m-mauve transition-colors"
          >
            ← 返回首页
          </button>
        </p>

      </div>
    </main>
  );
}
