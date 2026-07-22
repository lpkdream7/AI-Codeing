import { getChatGPTUser } from "../app/chatgpt-auth";
import { getDb } from "../db";
import { users } from "../db/schema";

export async function getApiUser() {
  const user = await getChatGPTUser();
  if (!user) return null;

  const now = new Date().toISOString();
  await getDb()
    .insert(users)
    .values({
      email: user.email,
      displayName: user.displayName,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        displayName: user.displayName,
        updatedAt: now,
        lastSeenAt: now,
      },
    });

  return user;
}
