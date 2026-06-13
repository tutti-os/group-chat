import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production Nextop app workflow publishes Group Chat on main", async () => {
  const source = await readFile(".github/workflows/publish-nextop-app.yml", "utf8");

  assert.match(source, /name: Publish Nextop App Production/);
  assert.match(source, /branches:\n\s+- main/);
  assert.match(source, /uses: tutti-os\/tutti\/\.github\/workflows\/publish-nextop-app-release\.yml@main/);
  assert.match(source, /app_id: group-chat/);
  assert.match(source, /package_command: pnpm package:nextop/);
  assert.match(source, /package_dir: build\/nextop-app\/package/);
  assert.match(source, /icon_path: build\/nextop-app\/package\/icon\.svg/);
  assert.match(source, /NEXTOP_APP_RELEASES_PRODUCTION_PUBLISH_CATALOG/);
});

test("staging Nextop app workflow publishes Group Chat manually", async () => {
  const source = await readFile(".github/workflows/publish-nextop-app-staging.yml", "utf8");

  assert.match(source, /name: Publish Nextop App Staging/);
  assert.doesNotMatch(source, /\n\s+push:/);
  assert.match(source, /uses: tutti-os\/tutti\/\.github\/workflows\/publish-nextop-app-release\.yml@main/);
  assert.match(source, /app_id: group-chat/);
  assert.match(source, /package_command: pnpm package:nextop/);
  assert.match(source, /package_dir: build\/nextop-app\/package/);
  assert.match(source, /icon_path: build\/nextop-app\/package\/icon\.svg/);
  assert.match(source, /nextop-app-releases-staging/);
});
