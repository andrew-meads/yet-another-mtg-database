import { describe, it, expect } from "vitest";
import { slimCardForLlm } from "@/lib/ai/slim";
import { MtgCard } from "@/types/MtgCard";

const baseCard: MtgCard = {
  id: "abc",
  lang: "en",
  layout: "normal",
  cmc: 2,
  colors: ["G"],
  color_identity: ["G"],
  keywords: [],
  name: "Sylvan Test",
  mana_cost: "{1}{G}",
  type_line: "Creature — Elf",
  oracle_text: "Vigilance",
  power: "2",
  toughness: "3",
  border_color: "black",
  collector_number: "1",
  image_status: "highres_scan",
  image_uris: { normal: "https://cards.scryfall.io/x.jpg" },
  rarity: "common",
  set_name: "Test Set",
  set: "tst"
};

describe("slimCardForLlm", () => {
  it("keeps rules-relevant fields and drops images and empty values", () => {
    const slim = slimCardForLlm(baseCard);
    expect(slim).toMatchObject({
      id: "abc",
      name: "Sylvan Test",
      mana_cost: "{1}{G}",
      cmc: 2,
      type_line: "Creature — Elf",
      oracle_text: "Vigilance",
      rarity: "common",
      set: "tst"
    });
    expect(slim).not.toHaveProperty("image_uris");
    expect(slim).not.toHaveProperty("set_name");
    // Empty keywords array is dropped, undefined loyalty is dropped.
    expect(slim).not.toHaveProperty("keywords");
    expect(slim).not.toHaveProperty("loyalty");
  });

  it("keeps per-face text for multi-faced cards, without face images", () => {
    const slim = slimCardForLlm({
      ...baseCard,
      layout: "transform",
      oracle_text: undefined,
      mana_cost: undefined,
      card_faces: [
        {
          name: "Front",
          mana_cost: "{G}",
          type_line: "Creature",
          oracle_text: "Front text",
          colors: ["G"],
          image_uris: { normal: "https://cards.scryfall.io/f.jpg" }
        },
        { name: "Back", type_line: "Creature", oracle_text: "Back text", colors: [] }
      ]
    });
    expect(slim.card_faces).toEqual([
      {
        name: "Front",
        mana_cost: "{G}",
        type_line: "Creature",
        oracle_text: "Front text",
        colors: ["G"]
      },
      { name: "Back", type_line: "Creature", oracle_text: "Back text" }
    ]);
  });

  it("attaches prices when provided", () => {
    const prices = {
      usd: "1.00",
      usd_foil: null,
      usd_etched: null,
      eur: null,
      eur_foil: null,
      tix: null
    };
    expect(slimCardForLlm(baseCard, prices).prices).toEqual(prices);
    expect(slimCardForLlm(baseCard)).not.toHaveProperty("prices");
  });
});
