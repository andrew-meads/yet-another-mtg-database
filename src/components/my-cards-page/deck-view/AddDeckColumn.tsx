import { CARD_WIDTH, CARD_HEIGHT } from "./card-dimensions";

export default function AddDeckColumn() {
  return (
    <div className="flex flex-col min-w-min border border-dashed rounded-[5px]">
      <div
        className="shrink-0"
        style={{
          width: `${CARD_WIDTH}px`,
          height: `${CARD_HEIGHT}px`
        }}
      ></div>
    </div>
  );
}
