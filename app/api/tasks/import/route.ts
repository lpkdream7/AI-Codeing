import { getDb } from "../../../../db";
import { tasks } from "../../../../db/schema";
import { getApiUser } from "../../../../lib/api-user";
import { cleanTitle, isDateKey, isPriority, taskApiError } from "../../../../lib/task-api";

type ImportedTask = {
  title?: unknown;
  completed?: unknown;
  priority?: unknown;
  due?: unknown;
  createdAt?: unknown;
};

export async function POST(request: Request) {
  try {
    const user = await getApiUser();
    if (!user) return Response.json({ error: "请先登录" }, { status: 401 });

    const body = (await request.json()) as { tasks?: ImportedTask[] };
    const source = Array.isArray(body.tasks) ? body.tasks.slice(0, 200) : [];
    const now = new Date().toISOString();
    const values = source
      .map((item) => ({
        id: crypto.randomUUID(),
        ownerEmail: user.email,
        title: cleanTitle(item.title),
        completed: item.completed === true,
        priority: isPriority(item.priority) ? item.priority : ("medium" as const),
        due: isDateKey(item.due) ? item.due : "",
        createdAt: typeof item.createdAt === "string" ? item.createdAt : now,
        updatedAt: now,
        version: 1,
      }))
      .filter((item) => item.title);

    const imported = [];
    for (let index = 0; index < values.length; index += 50) {
      const chunk = values.slice(index, index + 50);
      if (chunk.length) imported.push(...(await getDb().insert(tasks).values(chunk).returning()));
    }

    return Response.json({ tasks: imported, imported: imported.length }, { status: 201 });
  } catch (error) {
    return Response.json({ error: taskApiError(error) }, { status: 500 });
  }
}
