import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function loadModule() {
  const output = "/tmp/message-clipboard.test.mjs";
  await execFileAsync("pnpm", [
    "--filter", "@group-chat/web", "exec", "esbuild", "src/app/chat-links.ts",
    "--bundle", "--platform=node", "--format=esm", `--outfile=${output}`,
  ]);
  return import(`${pathToFileURL(output)}?t=${Date.now()}`);
}

function installClipboardMocks(options = {}) {
  const nativeCopies = [];
  const writes = [];
  const storage = new Map();
  const previous = {
    ClipboardItem: globalThis.ClipboardItem,
    fetch: globalThis.fetch,
    navigator: globalThis.navigator,
    sessionStorage: globalThis.sessionStorage,
    window: globalThis.window,
  };

  globalThis.ClipboardItem = class ClipboardItemMock {
    static supports(type) {
      return type === "image/png";
    }

    constructor(items) {
      this.items = items;
    }
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        write: async (items) => {
          const firstItem = items[0]?.items ?? {};
          if (options.rejectImageWrite && firstItem["image/png"]) {
            throw new Error("image clipboard rejected");
          }
          writes.push(items);
        },
      },
    },
  });
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/api/artifacts/") && String(url).endsWith("/copy-image")) {
      nativeCopies.push({ body: init?.body, url: String(url) });
      if (options.rejectNativeCopy) {
        return {
          ok: false,
          statusText: "native copy rejected",
          text: async () => "native copy rejected",
        };
      }
      return {
        ok: true,
        json: async () => ({ ok: true }),
      };
    }
    return {
      ok: true,
      blob: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
    };
  };
  globalThis.sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    removeItem: (key) => {
      storage.delete(key);
    },
    setItem: (key, value) => {
      storage.set(key, String(value));
    },
  };
  globalThis.window = { location: { origin: "http://app.test" } };

  return {
    storage,
    nativeCopies,
    writes,
    restore() {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete globalThis[key];
        } else {
          Object.defineProperty(globalThis, key, { configurable: true, value });
        }
      }
    },
  };
}

test("copies an internal message image through the native image clipboard", async () => {
  const mocks = installClipboardMocks();
  try {
    const { copyMessagesToClipboard } = await loadModule();

    await copyMessagesToClipboard({
      text: "",
      artifactIds: ["artifact-image"],
      artifacts: [{
        id: "artifact-image",
        filename: "copied.png",
        mimeType: "image/png",
        publicUrl: "/local-assets/copied.png",
        localPath: "",
      }],
      includeText: false,
    });

    assert.equal(mocks.nativeCopies.length, 1);
    assert.equal(mocks.nativeCopies[0].body, undefined);
    assert.equal(mocks.writes.length, 0);
    const stash = JSON.parse(mocks.storage.get("group-chat:artifact-ids"));
    assert.deepEqual(stash.artifactIds, ["artifact-image"]);
    assert.equal(stash.includeText, false);
  } finally {
    mocks.restore();
  }
});

test("passes copied message text to the native image clipboard for mixed image and text copies", async () => {
  const mocks = installClipboardMocks();
  try {
    const { copyMessagesToClipboard } = await loadModule();

    await copyMessagesToClipboard({
      text: "caption text",
      artifactIds: ["artifact-image"],
      artifacts: [{
        id: "artifact-image",
        filename: "captioned.png",
        mimeType: "image/png",
        publicUrl: "/local-assets/captioned.png",
        localPath: "",
      }],
      includeText: true,
    });

    assert.equal(mocks.nativeCopies.length, 1);
    assert.deepEqual(JSON.parse(mocks.nativeCopies[0].body), { text: "caption text" });
    assert.equal(mocks.writes.length, 0);
    const stash = JSON.parse(mocks.storage.get("group-chat:artifact-ids"));
    assert.deepEqual(stash.artifactIds, ["artifact-image"]);
    assert.equal(stash.includeText, true);
  } finally {
    mocks.restore();
  }
});

test("falls back to internal clipboard data when native and browser image writes are rejected", async () => {
  const mocks = installClipboardMocks({ rejectImageWrite: true, rejectNativeCopy: true });
  try {
    const { ARTIFACT_CLIPBOARD_MIME, copyMessagesToClipboard } = await loadModule();

    await copyMessagesToClipboard({
      text: "",
      artifactIds: ["artifact-image"],
      artifacts: [{
        id: "artifact-image",
        filename: "fallback.png",
        mimeType: "image/png",
        publicUrl: "/local-assets/fallback.png",
        localPath: "",
      }],
      includeText: false,
    });

    assert.equal(mocks.writes.length, 1);
    const item = mocks.writes[0][0].items;
    assert.equal(item["image/png"], undefined);
    assert.ok(item[ARTIFACT_CLIPBOARD_MIME], "expected internal artifact payload when image writes fail");
    assert.ok(item["text/html"], "expected internal HTML payload when image writes fail");
  } finally {
    mocks.restore();
  }
});
