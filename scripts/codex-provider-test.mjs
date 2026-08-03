import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { CodexProvider } from "../dist/codexProvider.js";

if (process.platform === "win32") await testWindowsArgumentsAreLiteral();

console.log("codex provider tests passed");

async function testWindowsArgumentsAreLiteral() {
  const cwd = await mkdtemp(join(tmpdir(), "skinnycoder-provider-test-"));
  const bin = join(cwd, "bin");
  const marker = join(cwd, "injected.txt");
  const maliciousModel = `safe & echo injected>${marker} & rem`;
  const previousPath = process.env.PATH;

  try {
    await mkdir(join(cwd, ".codex"), { recursive: true });
    await mkdir(bin, { recursive: true });
    await writeFile(
      join(bin, "codex.cmd"),
      '@echo off\r\necho {"type":"item.completed","item":{"type":"agent_message","text":"ok"}}\r\n',
      "utf8"
    );
    await writeFile(
      join(cwd, ".codex", "config.toml"),
      `model = '${maliciousModel}'\n`,
      "utf8"
    );
    process.env.PATH = `${bin}${delimiter}${previousPath ?? ""}`;

    const provider = new CodexProvider(cwd);
    assert.equal(await provider.reviewDiff("diff --git a/a b/a\n"), "ok");
    provider.setModel(maliciousModel);
    assert.equal(await provider.webSearch("test"), "ok");
    await assert.rejects(access(marker));
  } finally {
    process.env.PATH = previousPath;
    await rm(cwd, { recursive: true, force: true });
  }
}
