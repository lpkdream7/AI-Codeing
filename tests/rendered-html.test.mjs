import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("builds the cloud todo app shell", async () => {
  const [page, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    access(new URL("../dist/server/index.js", import.meta.url)),
  ]);

  assert.match(layout, /今日清单｜轻量待办/);
  assert.match(page, /今天，先做重要的事。/);
  assert.match(page, /写下下一件要做的事/);
  assert.match(page, /正在载入你的云端清单/);
  assert.match(page, /\/api\/tasks/);
  assert.doesNotMatch(page, /codex-preview|react-loading-skeleton/i);
});

test("ships account-scoped task storage", async () => {
  const [migration, collectionRoute, itemRoute] = await Promise.all([
    readFile(new URL("../drizzle/0000_shocking_wong.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/tasks/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/tasks/[id]/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /CREATE TABLE `users`/);
  assert.match(migration, /CREATE TABLE `tasks`/);
  assert.match(migration, /FOREIGN KEY \(`owner_email`\)/);
  assert.match(collectionRoute, /eq\(tasks\.ownerEmail, user\.email\)/);
  assert.match(itemRoute, /eq\(tasks\.version, version\)/);
});
