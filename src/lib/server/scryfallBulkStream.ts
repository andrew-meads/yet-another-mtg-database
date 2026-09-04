import type { Duplex, Readable } from "node:stream";
import { streamArray } from "stream-json/streamers/stream-array.js";

/**
 * One element of a Scryfall bulk-data array as emitted by
 * {@link createCardArrayStream}: `key` is the array index, `value` the card.
 */
export interface CardArrayItem<T = unknown> {
  key: number;
  value: T;
}

/**
 * Turn a byte/text source holding a Scryfall bulk JSON file (a single
 * top-level array of card objects) into an object stream that emits one
 * {@link CardArrayItem} per card, without ever holding the whole file in
 * memory. Backed by stream-json's parser + array streamer; the returned Duplex
 * supports the usual pause/resume/destroy backpressure controls.
 */
export function createCardArrayStream(source: Readable): Duplex {
  return source.pipe(streamArray.withParserAsStream());
}
