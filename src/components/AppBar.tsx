import { ModeToggle } from "./ui/ModeToggle";

export default function AppBar() {
  return (
    <header className="bg-background border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">Yet another MTG Database</h1>
          <ModeToggle />
        </div>
      </div>
    </header>
  );
}
