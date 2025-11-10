"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ModeToggle } from "./ui/ModeToggle";
import { Button } from "@/components/ui/button";
import { Separator } from "./ui/separator";
import ActiveCollectionButtons from "./ActiveCollectionButtons";

export default function AppBar() {
  const pathname = usePathname();

  return (
    <header className="bg-background border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-foreground">Yet another MTG Database</h1>
            <nav aria-label="Primary" className="flex items-center gap-2">
              <Button asChild variant={pathname === "/" ? "default" : "outline"} size="sm">
                <Link href="/">Card Search</Link>
              </Button>
              <Button asChild variant={pathname === "/my-cards" ? "default" : "outline"} size="sm">
                <Link href="/my-cards">My cards</Link>
              </Button>

              <Separator orientation="vertical" className="h-6! bg-foreground/20 mx-1" />

              <ActiveCollectionButtons />
            </nav>
          </div>
          <ModeToggle />
        </div>
      </div>
    </header>
  );
}
