import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { tasks } from "../../../db/schema";
import { getApiUser } from "../../../lib/api-user";
import { cleanTitle, isDateKey, isPriority, taskApiError } from "../../../lib/task-api";

export async function GET() {
  try {
    const user = await getApiUser();
    if (!user) return Response.json({ error: "请先登录" }, { status: 401 });

    const rows = await getDb()
      .select()
      .from(tasks)
      .where(eq(tasks.ownerEmail, user.email))
      .orderBy(asc(tasks.completed), asc(tasks.due), desc(tasks.createdAt));

    return Response.json({ tasks: rows, user });
  } catch (error) {
    return Response.json({ error: taskApiError(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getApiUser();
    if (!user) return Response.json({ error: "请先登录" }, { status: 401 });

    const body = (await request.json()) as Record<string, unknown>;
    const title = cleanTitle(body.title);
    const priority = isPriority(body.priority) ? body.priority : "medium";
    const due = isDateKey(body.due) ? body.due : "";
    const completed = body.completed === true;
    if (!title) return Response.json({ error: "任务内容不能为空" }, { status: 400 });

    const now = new Date().toISOString();
    const [task] = await getDb()
      .insert(tasks)
      .values({
        id: crypto.randomUUID(),
        ownerEmail: user.email,
        title,
        completed,
        priority,
        due,
        createdAt: now,
        updatedAt: now,
        version: 1,
      })
      .returning();

    return Response.json({ task }, { status: 201 });
  } catch (error) {
    return Response.json({ error: taskApiError(error) }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const user = await getApiUser();
    if (!user) return Response.json({ error: "请先登录" }, { status: 401 });

    const deleted = await getDb()
      .delete(tasks)
      .where(and(eq(tasks.ownerEmail, user.email), eq(tasks.completed, true)))
      .returning({ id: tasks.id });

    return Response.json({ deleted: deleted.length });
  } catch (error) {
    return Response.json({ error: taskApiError(error) }, { status: 500 });
  }
}
