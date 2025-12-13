"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ModeToggle } from "./ui/ModeToggle";
import { Button } from "@/components/ui/button";
import { OpenCollectionsList } from "./OpenCollectionButtons";
import { useSession, signOut } from "next-auth/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LogIn, LogOut, Camera, Search, FolderOpen, Menu } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { useIsDesktop } from "@/hooks/useIsDesktop";

export default function AppBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, status } = useSession();
  const { isDesktop, mounted } = useIsDesktop();

  const handleSignOut = async () => {
    await signOut({ callbackUrl: "/login" });
  };

  const handleSignIn = () => {
    router.push("/login");
  };

  return (
    <header className="bg-background border-b">
      <div className="max-w-7xl mx-auto px-2 sm:px-4 lg:px-8 py-2 sm:py-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
            <h1 className="text-base sm:text-xl md:text-2xl font-bold text-foreground truncate">
              <span className="hidden sm:inline">Yet another MTG Database</span>
              <span className="sm:hidden">YAMTG DB</span>
            </h1>
            <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-2">
              {status === "authenticated" && mounted && (
                <>
                  {isDesktop ? (
                    <DesktopNav pathname={pathname} />
                  ) : (
                    <MobileNav pathname={pathname} />
                  )}
                </>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {status === "authenticated" && session?.user ? (
              <Tooltip>
                <DropdownMenu>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button className="relative h-8 w-8 sm:h-10 sm:w-10 rounded-full overflow-hidden border-2 border-border hover:border-primary transition-colors flex items-center justify-center cursor-pointer">
                        {session.user.image ? (
                          <Image
                            src={session.user.image}
                            alt={session.user.name || "User"}
                            fill
                            sizes="(max-width: 640px) 32px, 40px"
                            className="object-cover"
                          />
                        ) : (
                          <div className="h-full w-full bg-primary/10 flex items-center justify-center text-sm font-semibold">
                            {session.user.name?.charAt(0).toUpperCase() || "?"}
                          </div>
                        )}
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={handleSignOut}>
                      <LogOut className="mr-2 h-4 w-4" />
                      Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <TooltipContent>
                  <p>{session.user.name || session.user.email}</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <Button className="cursor-pointer" variant="outline" size="sm" onClick={handleSignIn}>
                <LogIn className="mr-2 h-4 w-4" />
                <span className="hidden sm:inline">Login</span>
              </Button>
            )}
            <ModeToggle />
          </div>
        </div>
      </div>
    </header>
  );
}

/**
 * Desktop Navigation Component
 * Displays navigation links with text labels and open collection buttons
 */
function DesktopNav({ pathname }: { pathname: string }) {
  return (
    <div className="flex items-center gap-2">
      <Button asChild variant={pathname === "/search" ? "default" : "outline"} size="sm">
        <Link href="/search">
          <Search className="mr-2 h-4 w-4" />
          Card Search
        </Link>
      </Button>
      <Button asChild variant={pathname === "/scan" ? "default" : "outline"} size="sm">
        <Link href="/scan">
          <Camera className="mr-2 h-4 w-4" />
          Scan
        </Link>
      </Button>
      <Button asChild variant={pathname === "/my-cards" ? "default" : "outline"} size="sm">
        <Link href="/my-cards">
          <FolderOpen className="mr-2 h-4 w-4" />
          My cards
        </Link>
      </Button>

      {/* <Separator orientation="vertical" className="h-6! bg-foreground/20 mx-1" />
      <OpenCollectionButtons /> */}
    </div>
  );
}

/**
 * Mobile Navigation Component
 * Displays icon-only navigation buttons with tooltips and a drawer for open collections
 */
function MobileNav({ pathname }: { pathname: string }) {
  const [isCollectionsOpen, setIsCollectionsOpen] = useState(false);

  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            asChild
            variant={pathname === "/search" ? "default" : "outline"}
            size="icon"
            className="h-9 w-9"
          >
            <Link href="/search">
              <Search className="h-4 w-4" />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Card Search</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            asChild
            variant={pathname === "/scan" ? "default" : "outline"}
            size="icon"
            className="h-9 w-9"
          >
            <Link href="/scan">
              <Camera className="h-4 w-4" />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Scan</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            asChild
            variant={pathname === "/my-cards" ? "default" : "outline"}
            size="icon"
            className="h-9 w-9"
          >
            <Link href="/my-cards">
              <FolderOpen className="h-4 w-4" />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>My Cards</TooltipContent>
      </Tooltip>

      {/* Mobile collections menu */}
      <Sheet open={isCollectionsOpen} onOpenChange={setIsCollectionsOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="h-9 w-9">
                <Menu className="h-4 w-4" />
              </Button>
            </SheetTrigger>
          </TooltipTrigger>
          <TooltipContent>Open Collections</TooltipContent>
        </Tooltip>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Open Collections</SheetTitle>
          </SheetHeader>
          <div className="mt-4 w-full">
            <OpenCollectionsList />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
