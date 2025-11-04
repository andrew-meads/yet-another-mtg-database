"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ICard } from "@/types/ICard";
import { useEffect, useRef, useState } from "react";
import CardPopup from "@/components/CardPopup";

export interface CardsTableProps {
  cards: ICard[];
  isLoading?: boolean;
  error?: Error | null;
  maxHeight?: string;
  onCardClicked?: (card: ICard) => void;
}

function CardsTableRow({
  card,
  onClick,
  onHoverEnter,
  onHoverLeave,
  onHoverMove,
}: {
  card: ICard;
  onClick?: (card: ICard) => void;
  onHoverEnter?: () => void;
  onHoverLeave?: () => void;
  onHoverMove?: (e: React.MouseEvent<HTMLTableRowElement>) => void;
}) {
  return (
    <TableRow
      className="cursor-pointer"
      onClick={() => onClick?.(card)}
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
      onMouseMove={onHoverMove}
    >
      <TableCell className="font-medium">{card.name}</TableCell>
      <TableCell>{card.type_line}</TableCell>
      <TableCell className="text-right">{card.cmc}</TableCell>
    </TableRow>
  );
}

export default function CardsTable({ cards, isLoading, error, maxHeight, onCardClicked }: CardsTableProps) {
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

  const containerStyle = maxHeight ? { maxHeight, overflowY: "auto" as const } : undefined;

  // Hover preview popup state
  const [hovered, setHovered] = useState<{ card: ICard; pos: { x: number; y: number } } | null>(
    null
  );
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
    };
  }, []);

  const handleRowEnter = (card: ICard) => {
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

  return (
    <div style={containerStyle} className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">CMC</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cards.map((card) => (
            <CardsTableRow
              key={card.id}
              card={card}
              onClick={onCardClicked}
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
