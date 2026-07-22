import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schemaUrl = new URL("../deploy/mysql/001_init.sql", import.meta.url);

test("self-hosted MySQL schema covers accounts and synced tasks", async () => {
  const sql = await readFile(schemaUrl, "utf8");

  for (const table of [
    "users",
    "sessions",
    "email_verification_tokens",
    "password_reset_tokens",
    "tasks",
  ]) {
    assert.match(sql, new RegExp("CREATE TABLE IF NOT EXISTS `" + table + "`"));
  }

  assert.match(sql, /UNIQUE KEY `uq_users_email` \(`email`\)/);
  assert.match(sql, /`password_hash` VARCHAR\(255\)/);
  assert.match(sql, /`token_hash` CHAR\(64\)/);
  assert.match(sql, /`version` INT UNSIGNED NOT NULL DEFAULT 1/);
  assert.match(sql, /`deleted_at` DATETIME\(3\) NULL/);
  assert.match(sql, /FOREIGN KEY \(`user_id`\) REFERENCES `users` \(`id`\)/);
  assert.doesNotMatch(sql, /replace-with|password\s*=\s*['"][^'"]+['"]/i);
});
