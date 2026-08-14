const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";

export function printStatus(text: string): void { process.stdout.write(`\r\x1b[K${YELLOW}${text}${RESET}`); }
export function printRecognition(text: string): void { process.stdout.write(`\r${GREEN}🎤 ${text}${RESET}\n`); }
export function printAssistantDelta(text: string): void { process.stdout.write(text); }
export function printToolLine(text: string): void { process.stdout.write(`\n${DIM}└ ${text}${RESET}\n`); }
export function printError(text: string): void { process.stdout.write(`\r${RED}✖ ${text}${RESET}\n`); }
export function clearStatusLine(): void { process.stdout.write("\r\x1b[K"); }
