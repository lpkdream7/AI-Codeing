"use client";

import type { CSSProperties, FormEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

type Priority = "high" | "medium" | "low";
type Filter = "all" | "today" | "upcoming" | "completed";
type SyncStatus = "loading" | "syncing" | "synced" | "error";

type Task = {
  id: string;
  title: string;
  completed: boolean;
  priority: Priority;
  due: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

type UserInfo = {
  displayName: string;
  email: string;
  fullName: string | null;
};

type LocalTask = Partial<Task> & { title?: unknown };

const LEGACY_STORAGE_KEY = "today-list:tasks:v1";
const MIGRATION_KEY_PREFIX = "today-list:cloud-migrated:v1:";

const priorityLabel: Record<Priority, string> = {
  high: "重要",
  medium: "普通",
  low: "稍后",
};

class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;

  constructor(status: number, data: Record<string, unknown>) {
    super(typeof data.error === "string" ? data.error : "请求失败");
    this.status = status;
    this.data = data;
  }
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new ApiError(response.status, data);
  return data as T;
}

function toDateKey(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function addDays(dateKey: string, days: number) {
  if (!dateKey) return "";
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

export default function Home() {
  const selfHostedAuth =
    typeof document !== "undefined" &&
    document
      .querySelector('meta[name="today-list-auth-mode"]')
      ?.getAttribute("content") === "email";
  const [tasks, setTasks] = useState<Task[]>([]);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [due, setDue] = useState(() => toDateKey(new Date()));
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [deletedTask, setDeletedTask] = useState<Task | null>(null);
  const [notice, setNotice] = useState("");
  const [today] = useState(() => toDateKey(new Date()));
  const [dateLabel] = useState(() =>
    new Intl.DateTimeFormat("zh-CN", {
      month: "long",
      day: "numeric",
      weekday: "long",
    }).format(new Date()),
  );
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading");
  const [authRequired, setAuthRequired] = useState(false);
  const [savingTask, setSavingTask] = useState(false);
  const refreshingRef = useRef(false);
  const cancelEditRef = useRef(false);

  const loadTasks = useCallback(async (allowMigration = true) => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setSyncStatus((current) => (current === "loading" ? "loading" : "syncing"));

    try {
      const result = await requestJson<{ tasks: Task[]; user: UserInfo }>("/api/tasks");
      setUser(result.user);
      setAuthRequired(false);

      let cloudTasks = result.tasks;
      const migrationKey = `${MIGRATION_KEY_PREFIX}${result.user.email}`;
      if (allowMigration && cloudTasks.length === 0 && !localStorage.getItem(migrationKey)) {
        try {
          const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
          const localTasks = raw ? (JSON.parse(raw) as LocalTask[]) : [];
          const validTasks = Array.isArray(localTasks)
            ? localTasks.filter((task) => typeof task?.title === "string" && task.title.trim())
            : [];
          if (validTasks.length) {
            const imported = await requestJson<{ tasks: Task[] }>("/api/tasks/import", {
              method: "POST",
              body: JSON.stringify({ tasks: validTasks }),
            });
            cloudTasks = imported.tasks;
            setNotice(`已将 ${imported.tasks.length} 条旧任务迁移到云端`);
          }
          localStorage.setItem(migrationKey, "done");
        } catch {
          setNotice("旧任务暂未迁移，可稍后重新同步");
        }
      }

      setTasks(cloudTasks);
      setSyncStatus("synced");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAuthRequired(true);
      } else {
        setSyncStatus("error");
        setNotice(error instanceof Error ? error.message : "云端同步暂时不可用");
      }
    } finally {
      refreshingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadTasks(), 0);

    const refresh = () => {
      if (document.visibilityState === "visible") void loadTasks(false);
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadTasks(false);
    }, 20_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadTasks]);

  useEffect(() => {
    if (!deletedTask) return;
    const timer = window.setTimeout(() => setDeletedTask(null), 5000);
    return () => window.clearTimeout(timer);
  }, [deletedTask]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const activeTasks = tasks.filter((task) => !task.completed);
  const completedCount = tasks.length - activeTasks.length;
  const progress = tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0;
  const todayCount = activeTasks.filter(
    (task) => task.due && today && task.due <= today,
  ).length;

  const visibleTasks = (() => {
    const query = search.trim().toLocaleLowerCase("zh-CN");
    return tasks
      .filter((task) => {
        if (query && !task.title.toLocaleLowerCase("zh-CN").includes(query)) return false;
        if (filter === "today") {
          return !task.completed && !!task.due && !!today && task.due <= today;
        }
        if (filter === "upcoming") {
          return !task.completed && !!task.due && !!today && task.due > today;
        }
        if (filter === "completed") return task.completed;
        return true;
      })
      .sort((a, b) => {
        if (a.completed !== b.completed) return Number(a.completed) - Number(b.completed);
        if (a.due && b.due && a.due !== b.due) return a.due.localeCompare(b.due);
        if (a.due !== b.due) return a.due ? -1 : 1;
        return b.createdAt.localeCompare(a.createdAt);
      });
  })();

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "全部任务", count: tasks.length },
    { key: "today", label: "今天", count: todayCount },
    {
      key: "upcoming",
      label: "接下来",
      count: activeTasks.filter((task) => task.due && today && task.due > today).length,
    },
    { key: "completed", label: "已完成", count: completedCount },
  ];

  async function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle || savingTask) return;
    setSavingTask(true);
    setSyncStatus("syncing");

    try {
      const result = await requestJson<{ task: Task }>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ title: cleanTitle, priority, due }),
      });
      setTasks((current) => [result.task, ...current]);
      setTitle("");
      setFilter("all");
      setSyncStatus("synced");
    } catch (error) {
      setSyncStatus("error");
      setNotice(error instanceof Error ? error.message : "任务保存失败");
    } finally {
      setSavingTask(false);
    }
  }

  async function updateTask(task: Task, changes: Partial<Pick<Task, "title" | "completed" | "priority" | "due">>) {
    const optimistic = { ...task, ...changes };
    setTasks((current) => current.map((item) => (item.id === task.id ? optimistic : item)));
    setSyncStatus("syncing");

    try {
      const result = await requestJson<{ task: Task }>(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ ...changes, version: task.version }),
      });
      setTasks((current) => current.map((item) => (item.id === task.id ? result.task : item)));
      setSyncStatus("synced");
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setNotice("检测到另一台设备的更新，已载入最新内容");
        await loadTasks(false);
      } else {
        setTasks((current) => current.map((item) => (item.id === task.id ? task : item)));
        setSyncStatus("error");
        setNotice(error instanceof Error ? error.message : "任务更新失败");
      }
    }
  }

  async function deleteTask(task: Task) {
    setTasks((current) => current.filter((item) => item.id !== task.id));
    setSyncStatus("syncing");
    try {
      await requestJson<{ deleted: boolean }>(
        `/api/tasks/${encodeURIComponent(task.id)}?version=${task.version}`,
        { method: "DELETE" },
      );
      setDeletedTask(task);
      setSyncStatus("synced");
    } catch (error) {
      setTasks((current) => [task, ...current]);
      if (error instanceof ApiError && error.status === 409) await loadTasks(false);
      setSyncStatus("error");
      setNotice(error instanceof Error ? error.message : "任务删除失败");
    }
  }

  async function undoDelete() {
    if (!deletedTask) return;
    const task = deletedTask;
    setDeletedTask(null);
    setSyncStatus("syncing");
    try {
      const result = await requestJson<{ task: Task }>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: task.title,
          priority: task.priority,
          due: task.due,
          completed: task.completed,
        }),
      });
      setTasks((current) => [result.task, ...current]);
      setSyncStatus("synced");
    } catch (error) {
      setSyncStatus("error");
      setNotice(error instanceof Error ? error.message : "撤销失败");
    }
  }

  async function clearCompleted() {
    const removed = tasks.filter((task) => task.completed);
    setTasks((current) => current.filter((task) => !task.completed));
    setSyncStatus("syncing");
    try {
      await requestJson<{ deleted: number }>("/api/tasks", { method: "DELETE" });
      setSyncStatus("synced");
    } catch (error) {
      setTasks((current) => [...current, ...removed]);
      setSyncStatus("error");
      setNotice(error instanceof Error ? error.message : "清除失败");
    }
  }

  function startEditing(task: Task) {
    cancelEditRef.current = false;
    setEditingId(task.id);
    setEditingTitle(task.title);
  }

  function saveEditing(task: Task) {
    if (cancelEditRef.current) {
      cancelEditRef.current = false;
      return;
    }
    const cleanTitle = editingTitle.trim();
    setEditingId(null);
    setEditingTitle("");
    if (cleanTitle && cleanTitle !== task.title) void updateTask(task, { title: cleanTitle });
  }

  function handleEditKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") {
      cancelEditRef.current = true;
      setEditingId(null);
      setEditingTitle("");
      event.currentTarget.blur();
    }
  }

  function dueLabel(dateKey: string) {
    if (!dateKey) return "无截止日期";
    if (dateKey === today) return "今天";
    if (dateKey === addDays(today, 1)) return "明天";
    if (today && dateKey < today) return "已逾期";
    return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(
      new Date(`${dateKey}T12:00:00`),
    );
  }

  const syncLabel = {
    loading: "正在载入云端任务",
    syncing: "正在同步",
    synced: "所有设备已同步",
    error: "同步遇到问题",
  }[syncStatus];

  if (authRequired) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <span className="brand-mark" aria-hidden="true">✓</span>
          <span className="eyebrow">{selfHostedAuth ? "PRIVATE SYNC" : "CLOUD SYNC"}</span>
          <h1>登录后，清单会跟着你。</h1>
          <p>
            {selfHostedAuth
              ? "使用邮箱账户登录，在手机、平板和电脑上同步同一份任务。"
              : "使用 ChatGPT 账户登录，在手机、平板和电脑上同步同一份任务。"}
          </p>
          <a
            className="auth-button"
            href={selfHostedAuth ? "/login" : "/signin-with-chatgpt?return_to=%2F"}
          >
            {selfHostedAuth ? "邮箱登录 / 注册" : "使用 ChatGPT 登录"}
          </a>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="今日清单首页">
          <span className="brand-mark" aria-hidden="true">✓</span>
          <span>今日清单</span>
        </a>
        <button className={`sync-pill ${syncStatus}`} type="button" onClick={() => void loadTasks(false)}>
          <span aria-hidden="true" />
          {syncLabel}
        </button>
        <div className="topbar-actions">
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <span className="sr-only">搜索任务</span>
            <input
              type="search"
              placeholder="搜索任务"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {user && (
            <div className="account-menu">
              <span className="account-avatar" aria-hidden="true">{user.displayName.slice(0, 1).toUpperCase()}</span>
              <span className="account-copy">
                <strong>{user.displayName}</strong>
                <small>{user.email}</small>
              </span>
              <a href={selfHostedAuth ? "/api/auth/logout" : "/signout-with-chatgpt?return_to=%2F"}>退出</a>
            </div>
          )}
        </div>
      </header>

      <div className="workspace" id="top">
        <aside className="sidebar" aria-label="任务概览">
          <div className="sidebar-intro">
            <span className="eyebrow">DAILY FOCUS</span>
            <h2>保持轻盈，<br />一次完成一件事。</h2>
          </div>

          <div className="progress-card">
            <div
              className="progress-ring"
              style={{ "--progress": `${progress}%` } as CSSProperties}
              aria-label={`已完成 ${progress}%`}
            >
              <strong>{progress}</strong>
              <span>%</span>
            </div>
            <div>
              <span className="progress-label">今日进度</span>
              <strong>{activeTasks.length} 件待完成</strong>
            </div>
          </div>

          <nav className="filter-nav" aria-label="筛选任务">
            {filters.map((item) => (
              <button
                type="button"
                key={item.key}
                className={filter === item.key ? "active" : ""}
                aria-pressed={filter === item.key}
                onClick={() => setFilter(item.key)}
              >
                <span>{item.label}</span>
                <span className="filter-count">{item.count}</span>
              </button>
            ))}
          </nav>

          <div className="sidebar-note">
            <span aria-hidden="true">↗</span>
            <p>云端保存已开启，换台设备也能继续。</p>
          </div>
        </aside>

        <section className="main-panel" aria-labelledby="page-title">
          <div className="hero-copy">
            <div>
              <span className="eyebrow">{dateLabel}</span>
              <h1 id="page-title">今天，先做重要的事。</h1>
            </div>
            <p>{todayCount ? `今天还有 ${todayCount} 件事需要你。` : "今天的安排很从容。"}</p>
          </div>

          <form className="task-composer" onSubmit={addTask}>
            <label className="task-title-field">
              <span className="sr-only">新任务内容</span>
              <input
                autoComplete="off"
                placeholder="写下下一件要做的事…"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <div className="composer-options">
              <div className="priority-picker" aria-label="选择优先级">
                {(Object.keys(priorityLabel) as Priority[]).map((item) => (
                  <button
                    type="button"
                    key={item}
                    className={priority === item ? `selected ${item}` : ""}
                    aria-pressed={priority === item}
                    onClick={() => setPriority(item)}
                  >
                    <span className={`priority-dot ${item}`} aria-hidden="true" />
                    {priorityLabel[item]}
                  </button>
                ))}
              </div>
              <label className="date-field">
                <span aria-hidden="true">□</span>
                <span className="sr-only">截止日期</span>
                <input type="date" value={due} onChange={(event) => setDue(event.target.value)} />
              </label>
              <button className="add-button" type="submit" disabled={!title.trim() || savingTask}>
                <span aria-hidden="true">＋</span>
                {savingTask ? "保存中" : "添加任务"}
              </button>
            </div>
          </form>

          <div className="list-heading">
            <div>
              <h2>{filters.find((item) => item.key === filter)?.label}</h2>
              <span>{visibleTasks.length} 项</span>
            </div>
            {completedCount > 0 && (
              <button type="button" className="text-button" onClick={() => void clearCompleted()}>
                清除已完成
              </button>
            )}
          </div>

          <div className="task-list" aria-live="polite" aria-busy={syncStatus === "loading"}>
            {syncStatus === "loading" ? (
              <div className="cloud-loading">
                <span aria-hidden="true" />
                正在载入你的云端清单…
              </div>
            ) : visibleTasks.length ? (
              visibleTasks.map((task) => (
                <article className={`task-card ${task.completed ? "completed" : ""}`} key={task.id}>
                  <button
                    type="button"
                    className="task-check"
                    aria-label={task.completed ? `标记“${task.title}”为未完成` : `完成“${task.title}”`}
                    aria-pressed={task.completed}
                    onClick={() => void updateTask(task, { completed: !task.completed })}
                  >
                    <span aria-hidden="true">{task.completed ? "✓" : ""}</span>
                  </button>

                  <div className="task-content">
                    {editingId === task.id ? (
                      <input
                        className="edit-input"
                        aria-label="编辑任务"
                        autoFocus
                        value={editingTitle}
                        onChange={(event) => setEditingTitle(event.target.value)}
                        onBlur={() => saveEditing(task)}
                        onKeyDown={handleEditKey}
                      />
                    ) : (
                      <h3 onDoubleClick={() => startEditing(task)}>{task.title}</h3>
                    )}
                    <div className="task-meta">
                      <span className={`priority-tag ${task.priority}`}>{priorityLabel[task.priority]}</span>
                      <span className={today && task.due && task.due < today && !task.completed ? "overdue" : ""}>
                        {dueLabel(task.due)}
                      </span>
                      <span>v{task.version}</span>
                    </div>
                  </div>

                  <div className="task-actions">
                    <button type="button" aria-label={`编辑“${task.title}”`} onClick={() => startEditing(task)}>✎</button>
                    <button type="button" aria-label={`删除“${task.title}”`} onClick={() => void deleteTask(task)}>×</button>
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">
                <span aria-hidden="true">○</span>
                <h3>云端清单还是空的</h3>
                <p>{search ? "没有找到匹配的任务" : "添加第一件重要的事，它会自动同步到所有设备"}</p>
              </div>
            )}
          </div>

          <footer className="app-footer">
            <span className={`status-dot ${syncStatus}`} aria-hidden="true" />
            {syncLabel}
          </footer>
        </section>
      </div>

      {deletedTask && (
        <div className="toast" role="status">
          <span>任务已从云端删除</span>
          <button type="button" onClick={() => void undoDelete()}>撤销</button>
        </div>
      )}
      {notice && !deletedTask && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")}>知道了</button>
        </div>
      )}
    </main>
  );
}
