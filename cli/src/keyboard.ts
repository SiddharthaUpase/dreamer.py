// Kitty keyboard protocol support for detecting Shift+Enter
// When enabled, Shift+Enter sends \x1b[13;2u instead of \r
// Ink doesn't parse CSI u sequences, so we catch it on raw stdin

// Bracketed paste mode — terminal wraps pasted text with these markers
const BP_ENABLE  = "\x1b[?2004h";
const BP_DISABLE = "\x1b[?2004l";
const BP_START   = "\x1b[200~";
const BP_END     = "\x1b[201~";

let bpEnabled = false;
let bpListener: ((data: Buffer) => void) | null = null;

// Shared flag: true while a paste is being processed this tick.
// useInput handlers should check this and skip input while true.
export let isPasting = false;

export function enableBracketedPaste(onPaste: (text: string) => void): void {
  if (bpEnabled) return;
  bpEnabled = true;
  process.stdout.write(BP_ENABLE);

  let pasteBuffer = "";
  let inPaste = false;

  bpListener = (data: Buffer) => {
    const str = data.toString();

    if (!inPaste && str.includes(BP_START)) {
      inPaste = true;
      isPasting = true;
      pasteBuffer = str.slice(str.indexOf(BP_START) + BP_START.length);
    } else if (inPaste) {
      pasteBuffer += str;
    }

    if (inPaste && pasteBuffer.includes(BP_END)) {
      const text = pasteBuffer.slice(0, pasteBuffer.indexOf(BP_END));
      pasteBuffer = "";
      inPaste = false;
      onPaste(text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
      // Defer flag reset so Ink's useInput calls (same sync tick) still see isPasting=true
      setTimeout(() => { isPasting = false; }, 0);
    }
  };

  // prependListener so our handler fires BEFORE Ink's readline listener
  process.stdin.prependListener("data", bpListener);

  const cleanup = () => disableBracketedPaste();
  process.on("exit", cleanup);
  process.on("SIGINT",  () => { cleanup(); process.exit(0); });
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
}

export function disableBracketedPaste(): void {
  if (!bpEnabled) return;
  bpEnabled = false;
  isPasting = false;
  process.stdout.write(BP_DISABLE);
  if (bpListener) {
    process.stdin.removeListener("data", bpListener);
    bpListener = null;
  }
}
