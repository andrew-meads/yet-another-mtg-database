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

export interface CardsTableProps {
  cards: ICard[];
  isLoading?: boolean;
  error?: Error | null;
  maxHeight?: string;
  onCardClicked?: (card: ICard) => void;
}

function CardsTableRow({ card, onClick }: { card: ICard; onClick?: (card: ICard) => void }) {
  return (
    <TableRow
      className="cursor-pointer"
      onClick={() => onClick?.(card)}
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
            <CardsTableRow key={card.id} card={card} onClick={onCardClicked} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
