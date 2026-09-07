import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import {
  CardArrayItem,
  createCardArrayStream,
  createCardLinesStream,
  createCardStream,
  detectBulkLayout,
  isGzip,
  peekBytes
} from "../scryfallBulkStream";

async function drain(stream: Readable): Promise<CardArrayItem[]> {
  const items: CardArrayItem[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (item: CardArrayItem) => items.push(item));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return items;
}

const collectArray = (chunks: (string | Buffer)[]) =>
  drain(createCardArrayStream(Readable.from(chunks)));
const collectLines = (chunks: (string | Buffer)[]) =>
  drain(createCardLinesStream(Readable.from(chunks)));
const collectAny = async (chunks: (string | Buffer)[]) =>
  drain(await createCardStream(Readable.from(chunks)));

/** Split a buffer into fixed-size byte chunks (exercises boundary handling). */
function chunked(buf: Buffer, size: number): Buffer[] {
  const out: Buffer[] = [];
  for (let i = 0; i < buf.length; i += size) out.push(buf.subarray(i, i + size));
  return out;
}

describe("createCardArrayStream (legacy array layout)", () => {
  it("emits one { key, value } item per array element", async () => {
    const items = await collectArray([
      '[{"id":"a","name":"Ancestral Recall"},{"id":"b","name":"Black Lotus"}]'
    ]);
    expect(items).toEqual([
      { key: 0, value: { id: "a", name: "Ancestral Recall" } },
      { key: 1, value: { id: "b", name: "Black Lotus" } }
    ]);
  });

  it("assembles elements split across chunk boundaries", async () => {
    const items = await collectArray([
      '[{"id":"a","fa',
      'ces":[{"name":"x"}]},',
      '{"id":"b"}',
      "]"
    ]);
    expect(items.map((i) => i.value)).toEqual([{ id: "a", faces: [{ name: "x" }] }, { id: "b" }]);
  });

  it("emits nothing for an empty array", async () => {
    expect(await collectArray(["[]"])).toEqual([]);
  });

  it("surfaces malformed JSON as a stream error", async () => {
    await expect(collectArray(['[{"id":'])).rejects.toThrow();
  });
});

describe("createCardLinesStream (JSON Lines layout)", () => {
  it("emits one { key, value } item per line", async () => {
    const items = await collectLines([
      '{"id":"a","name":"Ancestral Recall"}\n{"id":"b","name":"Black Lotus"}\n'
    ]);
    expect(items).toEqual([
      { key: 0, value: { id: "a", name: "Ancestral Recall" } },
      { key: 1, value: { id: "b", name: "Black Lotus" } }
    ]);
  });

  it("handles a missing trailing newline, CRLF line endings, and blank lines", async () => {
    const items = await collectLines(['{"id":"a"}\r\n\r\n{"id":"b"}\n\n', '{"id":"c"}']);
    expect(items.map((i) => i.value)).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(items.map((i) => i.key)).toEqual([0, 1, 2]);
  });

  it("assembles lines and multi-byte characters split across byte chunks", async () => {
    const text = '{"id":"a","name":"Æther Vial ✨"}\n{"id":"b","name":"Lim-Dûl"}\n';
    const items = await collectLines(chunked(Buffer.from(text, "utf8"), 5));
    expect(items.map((i) => i.value)).toEqual([
      { id: "a", name: "Æther Vial ✨" },
      { id: "b", name: "Lim-Dûl" }
    ]);
  });

  it("emits nothing for an empty or whitespace-only source", async () => {
    expect(await collectLines([])).toEqual([]);
    expect(await collectLines(["\n\n  \n"])).toEqual([]);
  });

  it("surfaces an unparsable line as a stream error naming the line", async () => {
    await expect(collectLines(['{"id":"a"}\n{"id":\n'])).rejects.toThrow(/line 2/);
  });
});

describe("detection helpers", () => {
  it("isGzip recognizes the gzip magic bytes", () => {
    expect(isGzip(gzipSync("x"))).toBe(true);
    expect(isGzip(Buffer.from("[{}]"))).toBe(false);
    expect(isGzip(Buffer.alloc(0))).toBe(false);
  });

  it("detectBulkLayout picks array for a leading [ and jsonl otherwise, ignoring whitespace/BOM", () => {
    expect(detectBulkLayout("[{}]")).toBe("array");
    expect(detectBulkLayout("  \n\t[")).toBe("array");
    expect(detectBulkLayout("﻿[")).toBe("array");
    expect(detectBulkLayout('{"id":"a"}\n')).toBe("jsonl");
    expect(detectBulkLayout("")).toBe("jsonl");
  });

  it("peekBytes returns leading bytes without consuming them", async () => {
    const stream = Readable.from([Buffer.from("  \n"), Buffer.from("{}"), Buffer.from("\n{}")]);
    const head = await peekBytes(stream);
    expect(head.toString()).toBe("  \n{}");
    const all = await new Promise<string>((resolve) => {
      let s = "";
      stream.on("data", (c: Buffer) => (s += c.toString()));
      stream.on("end", () => resolve(s));
    });
    expect(all).toBe("  \n{}\n{}");
  });
});

describe("createCardStream (auto-detecting)", () => {
  const cards = [
    { id: "a", name: "Ancestral Recall" },
    { id: "b", name: "Black Lotus" }
  ];
  const jsonl = cards.map((c) => JSON.stringify(c)).join("\n") + "\n";
  const array = JSON.stringify(cards);

  it("reads plain JSON Lines", async () => {
    expect((await collectAny([jsonl])).map((i) => i.value)).toEqual(cards);
  });

  it("reads gzipped JSON Lines (Scryfall's current *.jsonl.gz), even in tiny chunks", async () => {
    const gz = gzipSync(jsonl);
    expect((await collectAny([gz])).map((i) => i.value)).toEqual(cards);
    expect((await collectAny(chunked(gz, 7))).map((i) => i.value)).toEqual(cards);
  });

  it("reads the legacy JSON array, plain or gzipped", async () => {
    expect((await collectAny([array])).map((i) => i.value)).toEqual(cards);
    expect((await collectAny([gzipSync(array)])).map((i) => i.value)).toEqual(cards);
  });

  it("tolerates leading whitespace before the layout marker", async () => {
    expect((await collectAny(["\n  " + array])).map((i) => i.value)).toEqual(cards);
    expect((await collectAny(["\n\n" + jsonl])).map((i) => i.value)).toEqual(cards);
  });

  it("emits nothing for an empty source", async () => {
    expect(await collectAny([])).toEqual([]);
  });

  it("surfaces a corrupt gzip stream as an error", async () => {
    const gz = gzipSync(jsonl);
    await expect(collectAny([gz.subarray(0, 40)])).rejects.toThrow();
  });
});
