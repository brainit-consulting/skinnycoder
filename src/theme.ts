import chalk from "chalk";

const amberHex = "#ffb000";
const darkAmber = "#9a6b00";

export const amber = chalk.hex(amberHex);
export const dim = chalk.hex(darkAmber);
export const ok = chalk.hex(amberHex);
export const error = chalk.redBright;
export const promptText = chalk.hex(amberHex).bold;

const logoLines = [
  "  ____  _  _______ _   _ _   ___   ______ ___  ____  _____ ____  ",
  " / ___|| |/ /_   _| \\ | | \\ | \\ \\ / / ___/ _ \\|  _ \\| ____|  _ \\ ",
  " \\___ \\| ' /  | | |  \\| |  \\| |\\ V / |  | | | | | | |  _| | |_) |",
  "  ___) | . \\  | | | |\\  | |\\  | | || |__| |_| | |_| | |___|  _ < ",
  " |____/|_|\\_\\ |_| |_| \\_|_| \\_| |_| \\____\\___/|____/|_____|_| \\_\\"
];

export function banner(title: string): string {
  const line = "═".repeat(title.length + 8);
  return amber(`╔${line}╗\n║    ${title}    ║\n╚${line}╝`);
}

export function staticLogo(): string {
  return amber(logoLines.join("\n"));
}

export function startupInfo(cwd: string): string {
  const width = Math.min(72, Math.max(32, process.stdout.columns || 72));
  const divider = "-".repeat(width);
  return [
    "",
    dim(divider),
    dim("Created by: Emile du Toit"),
    dim("SkinnyCoder is a bare minimum coding harness that can be extended as needed..."),
    "",
    dim(`cwd: ${cwd}`),
    dim("auth: codex cli subscription first; run /login if needed"),
    dim("edits and shell commands require approval"),
    dim("hint: type /help to get started"),
    ""
  ].join("\n");
}

export async function animatedLogo(stream: NodeJS.WriteStream): Promise<void> {
  if (!stream.isTTY) {
    stream.write(`${staticLogo()}\n`);
    return;
  }

  stream.write("\x1b[?25l");
  for (const line of logoLines) {
    stream.write(`${amber(line)}\n`);
    await delay(55);
  }
  stream.write("\x1b[?25h");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
