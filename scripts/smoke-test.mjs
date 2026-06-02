import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();
const scratch = join(cwd, "scratch-smoke-test.txt");

rmSync(scratch, { force: true });

const cases = [
  {
    name: "slash commands",
    input: ["/status", "/context", "/files src", "/read package.json", "/changes", "/exit"],
    expect: ["hint: type /help to get started", "model:", "skinnycoder retained context", "last Codex call: none yet", "file cli.ts", "\"name\": \"skinnycoder\"", "no skinnycoder changes"]
  },
  {
    name: "codex answer",
    input: ["say hello in one short sentence", "/exit"],
    expectAny: ["Hello", "hello"]
  },
  {
    name: "approved create and undo",
    input: [
      "create a file named scratch-smoke-test.txt with one line saying smoke ok",
      "y",
      "/read scratch-smoke-test.txt",
      "/changes",
      "/undo",
      "/exit"
    ],
    expect: ["Approve create_file?", "wrote scratch-smoke-test.txt", "smoke ok", "1. scratch-smoke-test.txt", "undid scratch-smoke-test.txt"],
    after: () => {
      if (existsSync(scratch)) throw new Error("scratch-smoke-test.txt still exists after /undo");
    }
  }
];

for (const testCase of cases) {
  process.stdout.write(`smoke: ${testCase.name}... `);
  const output = await runCli(testCase.input);
  for (const text of testCase.expect ?? []) {
    if (!output.includes(text)) {
      throw new Error(`Missing expected text "${text}" in ${testCase.name}\n\n${output}`);
    }
  }
  if (testCase.expectAny && !testCase.expectAny.some((text) => output.includes(text))) {
    throw new Error(`Missing any expected text ${testCase.expectAny.join(", ")} in ${testCase.name}\n\n${output}`);
  }
  testCase.after?.();
  process.stdout.write("ok\n");
}

console.log("smoke tests passed");

function runCli(lines) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["dist/cli.js"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let index = 0;
    let settled = false;
    let lastPromptOffset = -1;

    const sendNext = () => {
      if (index >= lines.length) return;
      child.stdin.write(`${lines[index]}\n`);
      index += 1;
    };

    const maybeSend = () => {
      const promptOffset = Math.max(output.lastIndexOf("> "), output.lastIndexOf("[y/N] "));
      if (promptOffset <= lastPromptOffset) return;
      if (!output.endsWith("> ") && !output.endsWith("[y/N] ")) return;
      lastPromptOffset = promptOffset;
      sendNext();
    };

    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      maybeSend();
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
      maybeSend();
    });
    child.on("error", (err) => {
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`CLI exited with ${code}\n\n${output}`));
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`Timed out waiting for CLI smoke test\n\n${output}`));
    }, 90_000);
  });
}
