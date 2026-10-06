import { describe, it, expect } from "vitest";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  OVERLAP_OFFSET,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_SLIDER_MAX,
  ZOOM_SNAP_DISTANCE,
  clampZoom,
  deckCardDimensions,
  sliderToSnappedZoom,
  sliderToZoom,
  zoomToSlider
} from "@/lib/deckZoom";

const MID = ZOOM_SLIDER_MAX / 2;

describe("clampZoom", () => {
  it("keeps in-range values, rounding to whole percents", () => {
    expect(clampZoom(100)).toBe(100);
    expect(clampZoom(57.4)).toBe(57);
  });

  it("clamps to 20–200%", () => {
    expect(clampZoom(5)).toBe(ZOOM_MIN);
    expect(clampZoom(500)).toBe(ZOOM_MAX);
  });

  it("falls back to 100% for anything that isn't a finite number", () => {
    for (const bad of [undefined, null, "150", NaN, Infinity, {}]) {
      expect(clampZoom(bad)).toBe(ZOOM_DEFAULT);
    }
  });
});

describe("slider mapping", () => {
  it("puts 20% at the start, 100% in the middle and 200% at the end", () => {
    expect(sliderToZoom(0)).toBe(20);
    expect(sliderToZoom(MID)).toBe(100);
    expect(sliderToZoom(ZOOM_SLIDER_MAX)).toBe(200);
    expect(zoomToSlider(20)).toBe(0);
    expect(zoomToSlider(100)).toBe(MID);
    expect(zoomToSlider(200)).toBe(ZOOM_SLIDER_MAX);
  });

  it("is linear within each half", () => {
    expect(sliderToZoom(MID / 2)).toBe(60);
    expect(sliderToZoom(MID * 1.5)).toBe(150);
  });

  it("clamps out-of-range positions", () => {
    expect(sliderToZoom(-10)).toBe(20);
    expect(sliderToZoom(ZOOM_SLIDER_MAX + 10)).toBe(200);
  });

  it("round-trips every whole percent", () => {
    for (let z = ZOOM_MIN; z <= ZOOM_MAX; z++) {
      expect(sliderToZoom(zoomToSlider(z))).toBe(z);
    }
  });
});

describe("sliderToSnappedZoom", () => {
  it("snaps positions near the middle to exactly 100%", () => {
    expect(sliderToSnappedZoom(MID)).toBe(100);
    expect(sliderToSnappedZoom(MID - ZOOM_SNAP_DISTANCE)).toBe(100);
    expect(sliderToSnappedZoom(MID + ZOOM_SNAP_DISTANCE)).toBe(100);
  });

  it("leaves positions outside the snap zone alone", () => {
    expect(sliderToSnappedZoom(MID - ZOOM_SNAP_DISTANCE - 1)).toBe(
      sliderToZoom(MID - ZOOM_SNAP_DISTANCE - 1)
    );
    expect(sliderToSnappedZoom(MID + ZOOM_SNAP_DISTANCE + 1)).toBe(
      sliderToZoom(MID + ZOOM_SNAP_DISTANCE + 1)
    );
    expect(sliderToSnappedZoom(0)).toBe(20);
    expect(sliderToSnappedZoom(ZOOM_SLIDER_MAX)).toBe(200);
  });
});

describe("deckCardDimensions", () => {
  it("is the base card size at 100%", () => {
    expect(deckCardDimensions(100)).toEqual({
      scale: 1,
      cardWidth: CARD_WIDTH,
      cardHeight: CARD_HEIGHT,
      overlapOffset: OVERLAP_OFFSET,
      columnGap: 12
    });
  });

  it("scales everything to whole pixels", () => {
    expect(deckCardDimensions(50)).toEqual({
      scale: 0.5,
      cardWidth: 73,
      cardHeight: 102,
      overlapOffset: 15,
      columnGap: 6
    });
    expect(deckCardDimensions(200)).toMatchObject({
      cardWidth: 292,
      cardHeight: 408,
      overlapOffset: 60,
      columnGap: 24
    });
  });

  it("keeps a minimum column gap when zoomed far out", () => {
    expect(deckCardDimensions(20).columnGap).toBe(4);
  });

  it("clamps an out-of-range zoom", () => {
    expect(deckCardDimensions(1000)).toEqual(deckCardDimensions(200));
  });
});
