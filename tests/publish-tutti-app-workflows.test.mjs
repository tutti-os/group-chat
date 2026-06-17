import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production Tutti app workflow publishes Group Chat from a release bump", async () => {
  const source = await readFile(".github/workflows/publish-tutti-app.yml", "utf8");

  assert.match(source, /name: Publish Tutti App Production/);
  assert.doesNotMatch(source, /\n\s+push:/);
  assert.match(source, /contents: write/);
  assert.match(source, /release_bump:/);
  assert.match(source, /default: patch/);
  assert.match(
    source,
    /publish_catalog:[\s\S]*Whether to publish the production App Center catalog[\s\S]*default: true/,
  );
  assert.match(source, /uses: tutti-os\/tutti\/\.github\/workflows\/publish-tutti-app-release\.yml@main/);
  assert.match(source, /app_id: group-chat/);
  assert.match(source, /package_command: pnpm package:tutti/);
  assert.match(source, /package_dir: build\/tutti-app\/package/);
  assert.match(source, /icon_path: build\/tutti-app\/package\/icon\.png/);
  assert.match(source, /release_tag_prefix: group-chat-v/);
  assert.match(source, /release_bump: \$\{\{ inputs\.release_bump \}\}/);
  assert.match(source, /create_release_tag: \$\{\{ !inputs\.catalog_only \}\}/);
  assert.doesNotMatch(source, /release_version/);
  assert.doesNotMatch(source, /TUTTI_APP_RELEASES_PRODUCTION_PUBLISH_CATALOG/);
});

test("staging Tutti app workflow publishes Group Chat manually", async () => {
  const source = await readFile(".github/workflows/publish-tutti-app-staging.yml", "utf8");

  assert.match(source, /name: Publish Tutti App Staging/);
  assert.doesNotMatch(source, /\n\s+push:/);
  assert.match(source, /uses: tutti-os\/tutti\/\.github\/workflows\/publish-tutti-app-release\.yml@main/);
  assert.match(source, /app_id: group-chat/);
  assert.match(source, /package_command: pnpm package:tutti/);
  assert.match(source, /package_dir: build\/tutti-app\/package/);
  assert.match(source, /icon_path: build\/tutti-app\/package\/icon\.png/);
  assert.match(source, /tutti-app-releases-staging/);
  assert.doesNotMatch(source, /release_version/);
});
