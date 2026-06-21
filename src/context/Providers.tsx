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
import { AuthModeProvider } from "@/context/AuthModeContext";

export function Providers({
  children,
  session,
  disableLogin = false
}: {
  children: React.ReactNode;
  session: Session | null;
  disableLogin?: boolean;
}) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <SessionProvider session={session}>
        <AuthModeProvider disableLogin={disableLogin}>
          <QueryProvider>
            <ReactDndProvider>
              <OpenEntitiesProvider>
                <CardSelectionProvider>
                  <ScanContextProvider>{children}</ScanContextProvider>
                </CardSelectionProvider>
              </OpenEntitiesProvider>

              {/* Drag layers */}
              <CardDragLayer />
              <DeckColumnDragLayer />
            </ReactDndProvider>
          </QueryProvider>
        </AuthModeProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
