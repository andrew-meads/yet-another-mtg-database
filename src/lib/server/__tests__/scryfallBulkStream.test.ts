import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { CardArrayItem, createCardArrayStream } from "../scryfallBulkStream";

async function collect(chunks: string[]): Promise<CardArrayItem[]> {
  const items: CardArrayItem[] = [];
  const stream = createCardArrayStream(Readable.from(chunks));
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (item: CardArrayItem) => items.push(item));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return items;
}

describe("createCardArrayStream", () => {
  it("emits one { key, value } item per array element", async () => {
    const items = await collect(['[{"id":"a","name":"Ancestral Recall"},{"id":"b","name":"Black Lotus"}]']);
    expect(items).toEqual([
      { key: 0, value: { id: "a", name: "Ancestral Recall" } },
      { key: 1, value: { id: "b", name: "Black Lotus" } }
    ]);
  });

  it("assembles elements split across chunk boundaries", async () => {
    const items = await collect(['[{"id":"a","fa', 'ces":[{"name":"x"}]},', '{"id":"b"}', "]"]);
    expect(items.map((i) => i.value)).toEqual([{ id: "a", faces: [{ name: "x" }] }, { id: "b" }]);
  });

  it("emits nothing for an empty array", async () => {
    expect(await collect(["[]"])).toEqual([]);
  });

  it("surfaces malformed JSON as a stream error", async () => {
    await expect(collect(['[{"id":'])).rejects.toThrow();
  });
});
