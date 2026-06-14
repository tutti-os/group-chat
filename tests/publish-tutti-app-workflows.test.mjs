import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production Tutti app workflow publishes Group Chat on main", async () => {
  const source = await readFile(".github/workflows/publish-tutti-app.yml", "utf8");

  assert.match(source, /name: Publish Tutti App Production/);
  assert.match(source, /branches:\n\s+- main/);
  assert.match(source, /uses: tutti-os\/tutti\/\.github\/workflows\/publish-tutti-app-release\.yml@main/);
  assert.match(source, /app_id: group-chat/);
  assert.match(source, /package_command: pnpm package:tutti/);
  assert.match(source, /package_dir: build\/tutti-app\/package/);
  assert.match(source, /icon_path: build\/tutti-app\/package\/icon\.svg/);
  assert.match(source, /TUTTI_APP_RELEASES_PRODUCTION_PUBLISH_CATALOG/);
});

test("staging Tutti app workflow publishes Group Chat manually", async () => {
  const source = await readFile(".github/workflows/publish-tutti-app-staging.yml", "utf8");

  assert.match(source, /name: Publish Tutti App Staging/);
  assert.doesNotMatch(source, /\n\s+push:/);
  assert.match(source, /uses: tutti-os\/tutti\/\.github\/workflows\/publish-tutti-app-release\.yml@main/);
  assert.match(source, /app_id: group-chat/);
  assert.match(source, /package_command: pnpm package:tutti/);
  assert.match(source, /package_dir: build\/tutti-app\/package/);
  assert.match(source, /icon_path: build\/tutti-app\/package\/icon\.svg/);
  assert.match(source, /tutti-app-releases-staging/);
});
