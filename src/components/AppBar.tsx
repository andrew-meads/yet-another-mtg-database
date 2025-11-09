import Link from "next/link";
import { ModeToggle } from "./ui/ModeToggle";
import { Button } from "@/components/ui/button";

export default function AppBar() {
  return (
    <header className="bg-background border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-foreground">Yet another MTG Database</h1>
            <nav aria-label="Primary" className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/">Card Search</Link>
              </Button>
            </nav>
          </div>
          <ModeToggle />
        </div>
      </div>
    </header>
  );
}
