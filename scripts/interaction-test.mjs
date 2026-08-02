import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PromptInput } from "../dist/input.js";
import { parseEditCommand, plannerIntentInstructions } from "../dist/intent.js";
import { parseReadCommand } from "../dist/slash.js";
import { readFilePage } from "../dist/tools.js";

await testMultilinePaste();
testEditIntent();
testReadArguments();
await testPagedRead();

console.log("interaction tests passed");

async function testMultilinePaste() {
  const source = new EventEmitter();
  let prompt = "";
  const input = new PromptInput(source, { write: (text) => { prompt += text; } }, 5);
  const pasted = input.question("> ", { multilinePaste: true });
  source.emit("line", "first line");
  source.emit("line", "second line");
  source.emit("line", "third line");
  assert.equal(await pasted, "first line\nsecond line\nthird line");
  assert.equal(prompt, "> ");

  const single = input.question("> ", { multilinePaste: true });
  source.emit("line", "next request");
  assert.equal(await single, "next request");
  source.emit("close");
}

function testEditIntent() {
  assert.deepEqual(
    parseEditCommand('/edit "src/new route.ts" Keep it read-only.\nCreate the missing file.'),
    { path: "src/new route.ts", instruction: "Keep it read-only.\nCreate the missing file." }
  );
  assert.equal(parseEditCommand("/edit src/file.ts"), undefined);

  const missing = plannerIntentInstructions({ kind: "edit", path: "src/new.ts", targetExists: false }).join("\n");
  assert.match(missing, /Use create_file/);
  assert.match(missing, /do not stop after reading|requested edit is complete/);
}

function testReadArguments() {
  assert.deepEqual(parseReadCommand('"docs/long file.md" --from 201 --lines 75'), {
    path: "docs/long file.md",
    startLine: 201,
    lineCount: 75
  });
  assert.throws(() => parseReadCommand("README.md --lines 401"), /must not exceed 400/);
  assert.throws(() => parseReadCommand("README.md --from nope"), /positive integer/);
}

async function testPagedRead() {
  const cwd = await mkdtemp(join(tmpdir(), "skinnycoder-read-test-"));
  try {
    await writeFile(join(cwd, "sample.txt"), "one\ntwo\nthree\nfour\nfive\n", "utf8");
    const page = await readFilePage(cwd, "sample.txt", [], 2, 2);
    assert.match(page, /^two\nthree/m);
    assert.match(page, /showing lines 2-3 of 6/);
    assert.match(page, /\/read sample\.txt --from 4 --lines 2/);

    const complete = await readFilePage(cwd, "sample.txt", [], 1, 10);
    assert.doesNotMatch(complete, /continue with/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
