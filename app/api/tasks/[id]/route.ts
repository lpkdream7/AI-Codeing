import { and, eq, sql, type SQL } from "drizzle-orm";
import { getDb } from "../../../../db";
import { tasks } from "../../../../db/schema";
import { getApiUser } from "../../../../lib/api-user";
import { cleanTitle, isDateKey, isPriority, taskApiError, type TaskPriority } from "../../../../lib/task-api";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await getApiUser();
    if (!user) return Response.json({ error: "请先登录" }, { status: 401 });

    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const version = Number(body.version);
    if (!Number.isInteger(version) || version < 1) {
      return Response.json({ error: "任务版本无效" }, { status: 400 });
    }

    const changes: {
      title?: string;
      completed?: boolean;
      priority?: TaskPriority;
      due?: string;
      updatedAt: string;
      version: SQL;
    } = {
      updatedAt: new Date().toISOString(),
      version: sql`${tasks.version} + 1`,
    };

    if ("title" in body) {
      const title = cleanTitle(body.title);
      if (!title) return Response.json({ error: "任务内容不能为空" }, { status: 400 });
      changes.title = title;
    }
    if (typeof body.completed === "boolean") changes.completed = body.completed;
    if (isPriority(body.priority)) changes.priority = body.priority;
    if (isDateKey(body.due)) changes.due = body.due;

    const [updated] = await getDb()
      .update(tasks)
      .set(changes)
      .where(
        and(
          eq(tasks.id, id),
          eq(tasks.ownerEmail, user.email),
          eq(tasks.version, version),
        ),
      )
      .returning();

    if (updated) return Response.json({ task: updated });

    const [current] = await getDb()
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.ownerEmail, user.email)))
      .limit(1);

    if (!current) return Response.json({ error: "任务不存在" }, { status: 404 });
    return Response.json({ error: "任务已在另一台设备上更新", task: current }, { status: 409 });
  } catch (error) {
    return Response.json({ error: taskApiError(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await getApiUser();
    if (!user) return Response.json({ error: "请先登录" }, { status: 401 });

    const { id } = await context.params;
    const version = Number(new URL(request.url).searchParams.get("version"));
    if (!Number.isInteger(version) || version < 1) {
      return Response.json({ error: "任务版本无效" }, { status: 400 });
    }

    const [deleted] = await getDb()
      .delete(tasks)
      .where(
        and(
          eq(tasks.id, id),
          eq(tasks.ownerEmail, user.email),
          eq(tasks.version, version),
        ),
      )
      .returning({ id: tasks.id });

    if (deleted) return Response.json({ deleted: true });

    const [current] = await getDb()
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.ownerEmail, user.email)))
      .limit(1);

    if (!current) return Response.json({ deleted: true });
    return Response.json({ error: "任务已在另一台设备上更新" }, { status: 409 });
  } catch (error) {
    return Response.json({ error: taskApiError(error) }, { status: 500 });
  }
}
