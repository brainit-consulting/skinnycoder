import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as { version?: unknown };

export const skinnyCoderVersion = typeof packageJson.version === "string"
  ? packageJson.version
  : "0.0.0";
