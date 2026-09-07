import { Duplex, Readable, Transform, TransformCallback } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { createGunzip } from "node:zlib";
import { streamArray } from "stream-json/streamers/stream-array.js";

/**
 * One card as emitted by the bulk-data streams: `key` is the card's index in
 * the file (array index or line number), `value` the card object.
 */
export interface CardArrayItem<T = unknown> {
  key: number;
  value: T;
}

/** The two layouts Scryfall bulk data has shipped in. */
export type BulkLayout = "array" | "jsonl";

/**
 * Turn a byte/text source holding the LEGACY Scryfall bulk JSON layout (a
 * single top-level array of card objects) into an object stream that emits one
 * {@link CardArrayItem} per card, without ever holding the whole file in
 * memory. Backed by stream-json's parser + array streamer; the returned Duplex
 * supports the usual pause/resume/destroy backpressure controls.
 */
export function createCardArrayStream(source: Readable): Duplex {
  return forwardErrors(source, source.pipe(streamArray.withParserAsStream()));
}

/**
 * `pipe()` does not propagate errors downstream, so a failing source (file
 * read error, truncated gzip member, …) would leave the consumer waiting
 * forever. Destroy the destination with the source's error instead.
 */
function forwardErrors<T extends Duplex>(source: Readable, destination: T): T {
  source.on("error", (err) => destination.destroy(err));
  return destination;
}

/**
 * Parses JSON Lines (one JSON object per line — Scryfall's current bulk
 * layout, delivered as `*.jsonl.gz`) into {@link CardArrayItem}s. Tolerates
 * CRLF and blank lines, handles multi-byte characters split across chunks, and
 * surfaces an unparsable line as a stream error naming the line number.
 */
export class JsonLinesTransform extends Transform {
  private decoder = new StringDecoder("utf8");
  private rest = "";
  private line = 0;
  private index = 0;

  constructor() {
    super({ readableObjectMode: true });
  }

  _transform(chunk: Buffer | string, _enc: BufferEncoding, cb: TransformCallback) {
    const text = typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    const pieces = (this.rest + text).split("\n");
    this.rest = pieces.pop() ?? "";
    try {
      for (const piece of pieces) this.emitLine(piece);
    } catch (err) {
      return cb(err as Error);
    }
    cb();
  }

  _flush(cb: TransformCallback) {
    try {
      this.emitLine(this.rest + this.decoder.end());
      this.rest = "";
    } catch (err) {
      return cb(err as Error);
    }
    cb();
  }

  private emitLine(raw: string) {
    this.line++;
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.trim() === "") return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (err) {
      throw new Error(`Invalid JSON on line ${this.line}: ${(err as Error).message}`);
    }
    this.push({ key: this.index++, value } satisfies CardArrayItem);
  }
}

/** Turn a JSON Lines source into an object stream of {@link CardArrayItem}s. */
export function createCardLinesStream(source: Readable): Duplex {
  return forwardErrors(source, source.pipe(new JsonLinesTransform()));
}

/** gzip members start with the two magic bytes 1f 8b. */
export function isGzip(head: Uint8Array): boolean {
  return head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b;
}

/**
 * Decide the layout from the first non-whitespace character of the (decoded)
 * text: a JSON array opens with `[`; anything else (`{`) is JSON Lines. A UTF-8
 * BOM is skipped. Pure.
 */
export function detectBulkLayout(head: string): BulkLayout {
  const first = head.replace(/^﻿/, "").trimStart()[0];
  return first === "[" ? "array" : "jsonl";
}

function toBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  return Buffer.from(String(chunk));
}

/**
 * Read chunks off `stream` until one contains a non-whitespace byte (or the
 * stream ends), then push them all back so nothing is consumed. Resolves the
 * concatenated bytes seen (empty for an empty stream).
 */
export function peekBytes(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const seen: unknown[] = [];
    const finish = () => {
      cleanup();
      // unshift() prepends, so restore original order by pushing back in reverse.
      for (let i = seen.length - 1; i >= 0; i--) stream.unshift(seen[i] as Buffer);
      resolve(Buffer.concat(seen.map(toBuffer)));
    };
    const onReadable = () => {
      let chunk: unknown;
      while ((chunk = stream.read()) !== null) {
        seen.push(chunk);
        if (toBuffer(chunk).some((b) => b !== 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d)) {
          return finish();
        }
      }
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(seen.map(toBuffer)));
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      stream.off("readable", onReadable);
      stream.off("end", onEnd);
      stream.off("error", onError);
    };
    stream.on("readable", onReadable);
    stream.on("end", onEnd);
    stream.on("error", onError);
  });
}

/**
 * Open ANY Scryfall bulk-data download as an object stream of
 * {@link CardArrayItem}s: sniffs the first bytes to gunzip `*.gz` content
 * (Scryfall serves `application/gzip` with no `Content-Encoding`, so `fetch`
 * does not decompress it) and to pick the layout — today's JSON Lines
 * (`*.jsonl.gz`) or the legacy top-level JSON array — so file extensions and
 * content types are irrelevant. Nothing is consumed beyond the peek.
 */
export async function createCardStream(source: Readable): Promise<Duplex> {
  let stream: Readable = source;
  let head = await peekBytes(stream);
  if (isGzip(head)) {
    stream = forwardErrors(source, source.pipe(createGunzip()));
    head = await peekBytes(stream);
  }
  return detectBulkLayout(head.toString("utf8")) === "array"
    ? createCardArrayStream(stream)
    : createCardLinesStream(stream);
}
