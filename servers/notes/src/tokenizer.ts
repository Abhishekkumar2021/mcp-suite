/**
 * Hand-rolled BERT-uncased WordPiece tokenizer — pure JS, no dependencies.
 * Mirrors google-research/bert `tokenization.py` (BasicTokenizer +
 * WordpieceTokenizer) closely enough to feed all-MiniLM-L6-v2. We hand-roll it
 * for the same reason we hand-roll the frontmatter parser: avoid a native /
 * audit-heavy dependency (@huggingface/tokenizers is a Rust binding).
 */

const SPECIAL = { unk: "[UNK]", cls: "[CLS]", sep: "[SEP]", pad: "[PAD]" } as const;

/** True if a Unicode code point is a CJK character (BERT `_is_chinese_char`). */
function isCjk(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x20000 && cp <= 0x2a6df) ||
    (cp >= 0x2a700 && cp <= 0x2b73f) ||
    (cp >= 0x2b740 && cp <= 0x2b81f) ||
    (cp >= 0x2b820 && cp <= 0x2ceaf) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x2f800 && cp <= 0x2fa1f)
  );
}

/** BERT `_is_punctuation`: all non-alphanumeric ASCII + any Unicode P* category. */
function isPunct(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  if (
    (cp >= 33 && cp <= 47) ||
    (cp >= 58 && cp <= 64) ||
    (cp >= 91 && cp <= 96) ||
    (cp >= 123 && cp <= 126)
  ) {
    return true;
  }
  return /\p{P}/u.test(ch);
}

export class WordPieceTokenizer {
  private vocab: Map<string, number>;
  readonly unkId: number;
  readonly clsId: number;
  readonly sepId: number;
  readonly padId: number;

  constructor(vocabText: string) {
    this.vocab = new Map();
    const lines = vocabText.split(/\r?\n/);
    let i = 0;
    for (const line of lines) {
      // vocab.txt is one token per line; the line number is the id. Do not trim
      // away a token that is itself whitespace-like — but blank trailing lines
      // (from the split) must not consume ids, so stop at the first empty tail.
      const tok = line.replace(/\r$/, "");
      if (tok === "" && i >= lines.length - 2) break;
      this.vocab.set(tok, i);
      i++;
    }
    this.unkId = this.vocab.get(SPECIAL.unk)!;
    this.clsId = this.vocab.get(SPECIAL.cls)!;
    this.sepId = this.vocab.get(SPECIAL.sep)!;
    this.padId = this.vocab.get(SPECIAL.pad) ?? 0;
    if (this.unkId === undefined || this.clsId === undefined || this.sepId === undefined) {
      throw new Error("vocab.txt is missing required special tokens ([UNK]/[CLS]/[SEP]).");
    }
  }

  /** Normalize: strip control chars, pad CJK, lowercase, remove accents (NFD/Mn). */
  private normalize(text: string): string {
    let out = "";
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (cp === 0 || cp === 0xfffd) continue; // invalid
      if (cp !== 9 && cp !== 10 && cp !== 13 && cp < 32) continue; // control chars
      out += isCjk(cp) ? ` ${ch} ` : ch;
    }
    return out
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "");
  }

  /** Whitespace + punctuation split into basic tokens (BERT BasicTokenizer). */
  private basicTokenize(text: string): string[] {
    const tokens: string[] = [];
    for (const word of this.normalize(text).split(/\s+/)) {
      if (!word) continue;
      let cur = "";
      for (const ch of word) {
        if (isPunct(ch)) {
          if (cur) {
            tokens.push(cur);
            cur = "";
          }
          tokens.push(ch);
        } else {
          cur += ch;
        }
      }
      if (cur) tokens.push(cur);
    }
    return tokens;
  }

  /** Greedy longest-match-first WordPiece split of a single word. */
  private wordpiece(word: string): string[] {
    if (word.length > 200) return [SPECIAL.unk]; // BERT max_input_chars_per_word
    const out: string[] = [];
    let start = 0;
    while (start < word.length) {
      let end = word.length;
      let found: string | null = null;
      while (start < end) {
        const sub = (start > 0 ? "##" : "") + word.slice(start, end);
        if (this.vocab.has(sub)) {
          found = sub;
          break;
        }
        end--;
      }
      if (found === null) return [SPECIAL.unk]; // any unmatchable piece → whole word UNK
      out.push(found);
      start = end;
    }
    return out;
  }

  /**
   * Encode text into `[CLS] … [SEP]` token ids (truncated to maxLen) plus an
   * all-ones attention mask. We embed one text at a time (batch 1), so no
   * padding is needed.
   */
  encode(text: string, maxLen = 256): { inputIds: number[]; attentionMask: number[] } {
    const pieceIds: number[] = [];
    for (const tok of this.basicTokenize(text)) {
      for (const piece of this.wordpiece(tok)) {
        pieceIds.push(this.vocab.get(piece) ?? this.unkId);
      }
    }
    const body = pieceIds.slice(0, Math.max(0, maxLen - 2));
    const inputIds = [this.clsId, ...body, this.sepId];
    return { inputIds, attentionMask: inputIds.map(() => 1) };
  }
}
