import { type FormEvent, useState } from "react";

type AuthMode = "login" | "register";

type AuthResponse = {
  error?: string;
};

export function AuthPage({ mode }: { mode: AuthMode }) {
  const registering = mode === "register";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);

    try {
      const response = await fetch(registering ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, displayName }),
      });
      const result = (await response.json()) as AuthResponse;
      if (!response.ok) throw new Error(result.error || "请求失败，请稍后再试");
      window.location.assign("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "请求失败，请稍后再试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card auth-form-card">
        <a className="brand-mark" href="/" aria-label="返回今日清单">✓</a>
        <span className="eyebrow">PRIVATE SYNC</span>
        <h1>{registering ? "创建你的清单账户。" : "欢迎回来。"}</h1>
        <p>
          {registering
            ? "注册后，你的任务会安全保存在自己的服务器中。"
            : "使用邮箱和密码登录，继续处理所有设备上的任务。"}
        </p>

        <form className="auth-form" onSubmit={submit}>
          {registering && (
            <label>
              <span>显示名称</span>
              <input
                autoComplete="name"
                maxLength={80}
                placeholder="例如：李鹏坤"
                required
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
          )}
          <label>
            <span>邮箱</span>
            <input
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              placeholder="name@example.com"
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            <span>密码</span>
            <input
              autoComplete={registering ? "new-password" : "current-password"}
              minLength={10}
              maxLength={128}
              placeholder={registering ? "至少 10 位字符" : "输入你的密码"}
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button className="auth-button" disabled={submitting} type="submit">
            {submitting ? "处理中…" : registering ? "注册并登录" : "登录"}
          </button>
        </form>

        <div className="auth-switch">
          {registering ? "已经有账户？" : "还没有账户？"}
          <a href={registering ? "/login" : "/register"}>
            {registering ? "直接登录" : "创建账户"}
          </a>
        </div>
      </section>
    </main>
  );
}
