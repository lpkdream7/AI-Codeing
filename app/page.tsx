"use client";

import type { CSSProperties, FormEvent, KeyboardEvent } from "react";
import { useEffect, useMemo, useState } from "react";

type Priority = "high" | "medium" | "low";
type Filter = "all" | "today" | "upcoming" | "completed";

type Task = {
  id: string;
  title: string;
  completed: boolean;
  priority: Priority;
  due: string;
  createdAt: string;
};

const STORAGE_KEY = "today-list:tasks:v1";

const starterTasks: Task[] = [
  {
    id: "starter-1",
    title: "整理今天最重要的三件事",
    completed: false,
    priority: "high",
    due: "",
    createdAt: "2026-01-03T08:00:00.000Z",
  },
  {
    id: "starter-2",
    title: "预留 30 分钟处理邮件",
    completed: false,
    priority: "medium",
    due: "",
    createdAt: "2026-01-02T08:00:00.000Z",
  },
  {
    id: "starter-3",
    title: "记录一个值得继续探索的 AI 想法",
    completed: true,
    priority: "low",
    due: "",
    createdAt: "2026-01-01T08:00:00.000Z",
  },
];

const priorityLabel: Record<Priority, string> = {
  high: "重要",
  medium: "普通",
  low: "稍后",
};

function toDateKey(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

function createId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>(starterTasks);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [due, setDue] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [deletedTask, setDeletedTask] = useState<Task | null>(null);
  const [today, setToday] = useState("");
  const [dateLabel, setDateLabel] = useState("今天");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const now = new Date();
    const todayKey = toDateKey(now);
    setToday(todayKey);
    setDue(todayKey);
    setDateLabel(
      new Intl.DateTimeFormat("zh-CN", {
        month: "long",
        day: "numeric",
        weekday: "long",
      }).format(now),
    );

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) setTasks(parsed);
      } else {
        setTasks(
          starterTasks.map((task, index) => ({
            ...task,
            due: index === 1 ? addDays(todayKey, 1) : todayKey,
          })),
        );
      }
    } catch {
      setTasks(starterTasks);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  }, [hydrated, tasks]);

  useEffect(() => {
    if (!deletedTask) return;
    const timer = window.setTimeout(() => setDeletedTask(null), 5000);
    return () => window.clearTimeout(timer);
  }, [deletedTask]);

  const activeTasks = tasks.filter((task) => !task.completed);
  const completedCount = tasks.length - activeTasks.length;
  const progress = tasks.length
    ? Math.round((completedCount / tasks.length) * 100)
    : 0;
  const todayCount = activeTasks.filter(
    (task) => task.due && today && task.due <= today,
  ).length;

  const visibleTasks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("zh-CN");
    return tasks
      .filter((task) => {
        if (query && !task.title.toLocaleLowerCase("zh-CN").includes(query)) {
          return false;
        }
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
  }, [filter, search, tasks, today]);

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

  function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) return;

    const task: Task = {
      id: createId(),
      title: cleanTitle,
      completed: false,
      priority,
      due,
      createdAt: new Date().toISOString(),
    };
    setTasks((current) => [task, ...current]);
    setTitle("");
    setFilter("all");
  }

  function toggleTask(id: string) {
    setTasks((current) =>
      current.map((task) =>
        task.id === id ? { ...task, completed: !task.completed } : task,
      ),
    );
  }

  function deleteTask(task: Task) {
    setTasks((current) => current.filter((item) => item.id !== task.id));
    setDeletedTask(task);
  }

  function startEditing(task: Task) {
    setEditingId(task.id);
    setEditingTitle(task.title);
  }

  function saveEditing() {
    const cleanTitle = editingTitle.trim();
    if (editingId && cleanTitle) {
      setTasks((current) =>
        current.map((task) =>
          task.id === editingId ? { ...task, title: cleanTitle } : task,
        ),
      );
    }
    setEditingId(null);
    setEditingTitle("");
  }

  function handleEditKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") saveEditing();
    if (event.key === "Escape") {
      setEditingId(null);
      setEditingTitle("");
    }
  }

  function dueLabel(dateKey: string) {
    if (!dateKey) return "无截止日期";
    if (dateKey === today) return "今天";
    if (dateKey === addDays(today, 1)) return "明天";
    if (today && dateKey < today) return "已逾期";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "short",
      day: "numeric",
    }).format(new Date(`${dateKey}T12:00:00`));
  }

  const emptyMessage = search
    ? "没有找到匹配的任务"
    : filter === "completed"
      ? "完成第一件事后，它会出现在这里"
      : "这里很安静，正适合添加一件重要的事";

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="今日清单首页">
          <span className="brand-mark" aria-hidden="true">✓</span>
          <span>今日清单</span>
        </a>
        <span className="topbar-date">{dateLabel}</span>
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
            <p>把注意力留给真正重要的事。</p>
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
              <button className="add-button" type="submit" disabled={!title.trim()}>
                <span aria-hidden="true">＋</span>
                添加任务
              </button>
            </div>
          </form>

          <div className="list-heading">
            <div>
              <h2>{filters.find((item) => item.key === filter)?.label}</h2>
              <span>{visibleTasks.length} 项</span>
            </div>
            {completedCount > 0 && (
              <button
                type="button"
                className="text-button"
                onClick={() => setTasks((current) => current.filter((task) => !task.completed))}
              >
                清除已完成
              </button>
            )}
          </div>

          <div className="task-list" aria-live="polite">
            {visibleTasks.length ? (
              visibleTasks.map((task) => (
                <article className={`task-card ${task.completed ? "completed" : ""}`} key={task.id}>
                  <button
                    type="button"
                    className="task-check"
                    aria-label={task.completed ? `标记“${task.title}”为未完成` : `完成“${task.title}”`}
                    aria-pressed={task.completed}
                    onClick={() => toggleTask(task.id)}
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
                        onBlur={saveEditing}
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
                    </div>
                  </div>

                  <div className="task-actions">
                    <button type="button" aria-label={`编辑“${task.title}”`} onClick={() => startEditing(task)}>✎</button>
                    <button type="button" aria-label={`删除“${task.title}”`} onClick={() => deleteTask(task)}>×</button>
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">
                <span aria-hidden="true">○</span>
                <h3>暂时没有任务</h3>
                <p>{emptyMessage}</p>
              </div>
            )}
          </div>

          <footer className="app-footer">
            <span className="status-dot" aria-hidden="true" />
            任务已自动保存在当前设备
          </footer>
        </section>
      </div>

      {deletedTask && (
        <div className="toast" role="status">
          <span>任务已删除</span>
          <button
            type="button"
            onClick={() => {
              setTasks((current) => [deletedTask, ...current]);
              setDeletedTask(null);
            }}
          >
            撤销
          </button>
        </div>
      )}
    </main>
  );
}
