import pc from "picocolors";

export function printKilocodeStreamEvent(line: string, debug: boolean): void {
  if (debug) {
    process.stdout.write(pc.gray(line.endsWith("\n") ? line : `${line}\n`));
    return;
  }
  process.stdout.write(line.endsWith("\n") ? line : `${line}\n`);
}