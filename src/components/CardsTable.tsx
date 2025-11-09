"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { MtgCard } from "@/types/MtgCard";
import { useEffect, useRef, useState } from "react";
import { useCardSelection } from "@/context/CardSelectionContext";
import CardPopup from "@/components/CardPopup";
import { ManaCost } from "@/components/CardTextView";

export interface CardsTableProps {
  cards: MtgCard[];
  isLoading?: boolean;
  error?: Error | null;
  maxHeight?: string;
  onCardClicked?: (card: MtgCard) => void;
}

function CardsTableRow({
  card,
  onClick,
  onHoverEnter,
  onHoverLeave,
  onHoverMove
}: {
  card: MtgCard;
  onClick?: (card: MtgCard) => void;
  onHoverEnter?: () => void;
  onHoverLeave?: () => void;
  onHoverMove?: (e: React.MouseEvent<HTMLTableRowElement>) => void;
}) {
  // Extract values from card_faces if present, otherwise use card-level values
  const faces = card.card_faces || [];

  // Mana cost: show single face cost or both with "//"
  const manaCosts =
    faces.length > 0
      ? faces.map((f) => f.mana_cost).filter((c): c is string => Boolean(c))
      : card.mana_cost
        ? [card.mana_cost]
        : [];

  // Power/Toughness/Loyalty: show both faces if different, separated by "//"
  // Power/Toughness: combine as "P/T" per face, then join with "//"
  const powerToughness =
    faces.length > 0
      ? faces
          .filter((f) => f.power && f.toughness)
          .map((f) => `${f.power}/${f.toughness}`)
          .join(" // ")
      : card.power && card.toughness
        ? `${card.power}/${card.toughness}`
        : "";

  const loyalties =
    faces.length > 0
      ? faces.map((f) => f.loyalty).filter(Boolean)
      : card.loyalty
        ? [card.loyalty]
        : [];

  const loyalty = loyalties.length > 0 ? loyalties.join(" // ") : "";

  return (
    <TableRow
      className="cursor-pointer"
      onClick={() => onClick?.(card)}
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
      onMouseMove={onHoverMove}
    >
      <TableCell className="font-medium">{card.name}</TableCell>
      <TableCell className="text-center">
        {manaCosts.length > 0 && (
          <div className="flex justify-center items-center gap-1">
            {manaCosts.map((cost, idx) => (
              <div key={idx} className="flex items-center gap-1">
                {idx > 0 && <span className="text-muted-foreground">//</span>}
                <ManaCost cost={cost} />
              </div>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell>{card.type_line}</TableCell>
      <TableCell className="text-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>{card.set.toUpperCase()}</span>
          </TooltipTrigger>
          <TooltipContent>
            {card.set_name}
          </TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell className="text-center">{card.cmc}</TableCell>
      <TableCell className="text-center">{powerToughness}</TableCell>
      <TableCell className="text-center">{loyalty}</TableCell>
    </TableRow>
  );
}

export default function CardsTable({
  cards,
  isLoading,
  error,
  maxHeight,
  onCardClicked
}: CardsTableProps) {
  if (error) {
    return (
      <div className="rounded-md border border-destructive bg-destructive/10 p-4 text-destructive">
        <p className="font-semibold">Error loading cards</p>
        <p className="text-sm">{error.message}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="rounded-md border bg-muted/50 p-8 text-center text-muted-foreground">
        Loading cards...
      </div>
    );
  }

  if (!cards || cards.length === 0) {
    return (
      <div className="rounded-md border bg-muted/50 p-8 text-center text-muted-foreground">
        No cards found
      </div>
    );
  }

  // Hover preview popup state
  const [hovered, setHovered] = useState<{ card: MtgCard; pos: { x: number; y: number } } | null>(
    null
  );
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
    };
  }, []);

  const handleRowEnter = (card: MtgCard) => {
    if (showTimerRef.current) clearTimeout(showTimerRef.current);
    showTimerRef.current = setTimeout(() => {
      setHovered({ card, pos: lastMousePosRef.current });
    }, 500);
  };

  const handleRowLeave = () => {
    if (showTimerRef.current) clearTimeout(showTimerRef.current);
    showTimerRef.current = null;
    setHovered(null);
  };

  const handleRowMove = (e: React.MouseEvent<HTMLTableRowElement>) => {
    // Pass raw cursor coordinates; CardPopup applies its own offset and clamping
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
  };

  // Use maxHeight if provided, otherwise fill available height. When a caller
  // doesn't pass an explicit onCardClicked callback, use the CardSelection
  // context's setter (fallback is a noop if provider is not present).
  const { setSelectedCard } = useCardSelection();

  const clickHandler = onCardClicked ?? ((card: MtgCard) => setSelectedCard(card));

  const containerClass = maxHeight
    ? "rounded-md border overflow-hidden flex flex-col"
    : "h-full rounded-md border overflow-hidden flex flex-col";
  const containerStyle = maxHeight ? { maxHeight } : undefined;

  return (
    <div style={containerStyle} className={containerClass}>
      <Table stickyHeader>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="text-center">Mana Cost</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-center">Set</TableHead>
            <TableHead className="text-center">CMC</TableHead>
            <TableHead className="text-center">P/T</TableHead>
            <TableHead className="text-center">Loyalty</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cards.map((card) => (
            <CardsTableRow
              key={card.id}
              card={card}
              onClick={clickHandler}
              onHoverEnter={() => handleRowEnter(card)}
              onHoverLeave={handleRowLeave}
              onHoverMove={handleRowMove}
            />
          ))}
        </TableBody>
      </Table>
      {hovered && <CardPopup card={hovered.card} position={hovered.pos} />}
    </div>
  );
}
