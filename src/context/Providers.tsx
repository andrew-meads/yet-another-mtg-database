"use client";

import { ThemeProvider } from "@/components/ui/ThemeProvider";
import { SessionProvider } from "next-auth/react";
import { Session } from "next-auth";
import QueryProvider from "@/context/QueryProvider";
import ReactDndProvider from "@/components/dnd/ReactDndProvider";
import { OpenEntitiesProvider } from "@/context/OpenEntitiesContext";
import { CardSelectionProvider } from "@/context/CardSelectionContext";
import CardDragLayer from "@/components/dnd/CardDragLayer";
import DeckColumnDragLayer from "@/components/dnd/DeckColumnDragLayer";
import { ScanContextProvider } from "@/context/ScanContext";
import { SettingsProvider } from "@/context/SettingsContext";
import { SearchDocsProvider } from "@/context/SearchDocsContext";

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
            <OpenEntitiesProvider>
              <CardSelectionProvider>
                <SettingsProvider>
                  <SearchDocsProvider>
                    <ScanContextProvider>{children}</ScanContextProvider>
                  </SearchDocsProvider>
                </SettingsProvider>
              </CardSelectionProvider>
            </OpenEntitiesProvider>

            {/* Drag layers */}
            <CardDragLayer />
            <DeckColumnDragLayer />
          </ReactDndProvider>
        </QueryProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
