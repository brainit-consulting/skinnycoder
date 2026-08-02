type LineSource = {
  on(event: "line", listener: (line: string) => void): unknown;
  on(event: "close", listener: () => void): unknown;
};

type PromptWriter = {
  write(text: string): unknown;
};

type LineWaiter = {
  resolve: (line: string | undefined) => void;
  timer?: NodeJS.Timeout;
};

export class PromptInput {
  private readonly queuedLines: string[] = [];
  private readonly waiters: LineWaiter[] = [];
  private closed = false;

  constructor(
    source: LineSource,
    private readonly writer: PromptWriter,
    private readonly pasteWindowMs = 40
  ) {
    source.on("line", (line) => this.pushLine(line));
    source.on("close", () => this.close());
  }

  async question(prompt: string, options: { multilinePaste?: boolean } = {}): Promise<string> {
    this.writer.write(prompt);
    const first = await this.nextLine();
    if (first === undefined) throw new Error("input closed");
    if (!options.multilinePaste) return first;

    const lines = [first];
    while (true) {
      const next = await this.nextLine(this.pasteWindowMs);
      if (next === undefined) break;
      lines.push(next);
    }
    return lines.join("\n");
  }

  private pushLine(line: string): void {
    const waiter = this.waiters.shift();
    if (!waiter) {
      this.queuedLines.push(line);
      return;
    }
    if (waiter.timer) clearTimeout(waiter.timer);
    waiter.resolve(line);
  }

  private nextLine(timeoutMs?: number): Promise<string | undefined> {
    const queued = this.queuedLines.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.closed) return Promise.resolve(undefined);

    return new Promise((resolve) => {
      const waiter: LineWaiter = { resolve };
      if (timeoutMs !== undefined) {
        waiter.timer = setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          resolve(undefined);
        }, timeoutMs);
      }
      this.waiters.push(waiter);
    });
  }

  private close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve(undefined);
    }
  }
}
