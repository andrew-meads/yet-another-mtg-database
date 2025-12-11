"use client";

import { ThemeProvider } from "@/components/ui/ThemeProvider";
import { SessionProvider } from "next-auth/react";
import { Session } from "next-auth";
import QueryProvider from "@/components/QueryProvider";
import ReactDndProvider from "@/components/dnd/ReactDndProvider";
import { OpenCollectionsProvider } from "@/context/OpenCollectionsContext";
import { CardSelectionProvider } from "@/context/CardSelectionContext";
import CardDragLayer from "@/components/dnd/CardDragLayer";
import DeckColumnDragLayer from "@/components/dnd/DeckColumnDragLayer";
import { ScanContextProvider } from "@/context/ScanContext";

export function Providers({
  children,
  session
}: {
  children: React.ReactNode;
  session: Session | null;
}) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <SessionProvider session={session}>
        <QueryProvider>
          <ReactDndProvider>
            <OpenCollectionsProvider>
              <CardSelectionProvider>
                <ScanContextProvider>{children}</ScanContextProvider>
              </CardSelectionProvider>
            </OpenCollectionsProvider>

            {/* Drag layers */}
            <CardDragLayer />
            <DeckColumnDragLayer />
          </ReactDndProvider>
        </QueryProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
