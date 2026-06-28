/**
 * Text encoding helpers so edits don't corrupt files: BOM detection/preservation
 * (UTF-8, UTF-16LE/BE) and line-ending detection so a CRLF file stays CRLF after
 * an edit. Binary files are detected (NUL byte) and rejected by text operations.
 */

export interface TextMeta {
  bom: "utf8" | "utf16le" | "utf16be" | "none";
  eol: "\n" | "\r\n";
}

export interface DecodedText extends TextMeta {
  text: string; // BOM stripped, line endings preserved as-is in the string
}

/** Heuristic binary check: a NUL byte in the head means "not text". */
export function isProbablyBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** Dominant line ending in the text. */
export function detectEol(text: string): "\n" | "\r\n" {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(?<!\r)\n/g) || []).length;
  return crlf > lf ? "\r\n" : "\n";
}

/** Decode a buffer to text, recording BOM + EOL. Throws on binary content. */
export function decodeText(buf: Buffer): DecodedText {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    const text = buf.subarray(3).toString("utf8");
    return { text, bom: "utf8", eol: detectEol(text) };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    const text = buf.subarray(2).toString("utf16le");
    return { text, bom: "utf16le", eol: detectEol(text) };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    const text = swapped.toString("utf16le");
    return { text, bom: "utf16be", eol: detectEol(text) };
  }
  if (isProbablyBinary(buf)) throw new Error("Not a text file (binary content detected).");
  const text = buf.toString("utf8");
  return { text, bom: "none", eol: detectEol(text) };
}

/** Re-encode text to a buffer, restoring BOM and normalizing to the given EOL. */
export function encodeText(text: string, meta: TextMeta): Buffer {
  const normalized = meta.eol === "\r\n" ? text.replace(/\r?\n/g, "\r\n") : text.replace(/\r\n/g, "\n");
  switch (meta.bom) {
    case "utf8":
      return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(normalized, "utf8")]);
    case "utf16le":
      return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(normalized, "utf16le")]);
    case "utf16be": {
      const body = Buffer.from(normalized, "utf16le");
      body.swap16();
      return Buffer.concat([Buffer.from([0xfe, 0xff]), body]);
    }
    default:
      return Buffer.from(normalized, "utf8");
  }
}
