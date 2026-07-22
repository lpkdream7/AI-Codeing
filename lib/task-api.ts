export type TaskPriority = "high" | "medium" | "low";

export function isPriority(value: unknown): value is TaskPriority {
  return value === "high" || value === "medium" || value === "low";
}

export function isDateKey(value: unknown): value is string {
  return typeof value === "string" && (value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export function cleanTitle(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

export function taskApiError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const detail = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  const combined = `${message}\n${detail}`;

  if (combined.includes("no such table") || combined.includes('from "tasks"')) {
    return "任务数据库尚未完成初始化，请稍后重试。";
  }
  return "同步服务暂时不可用，请稍后重试。";
}
