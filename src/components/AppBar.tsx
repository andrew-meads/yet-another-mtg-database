"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ModeToggle } from "./ui/ModeToggle";
import { Button } from "@/components/ui/button";
import OpenCollectionButtons, { OpenCollectionsList } from "./OpenCollectionButtons";
import { useSession, signOut } from "next-auth/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LogIn, LogOut, Camera, Search, FolderOpen, Menu, ShieldOff, Settings } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { useAuthMode } from "@/context/AuthModeContext";

export default function AppBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, status } = useSession();
  const { disableLogin } = useAuthMode();
  const { isDesktop, mounted } = useIsDesktop();

  const handleSignOut = async () => {
    await signOut({ callbackUrl: "/login" });
  };

  const handleSignIn = () => {
    router.push("/login");
  };

  return (
    <header className="bg-background border-b">
      <div className="w-full p-2 sm:p-4 lg:px-8">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
            <h1 className="text-foreground shrink-0 text-base font-bold sm:text-xl md:text-2xl">
              <span className="hidden xl:inline">Yet another MTG Database</span>
              <span className="xl:hidden">YAMTG DB</span>
            </h1>
            <nav aria-label="Primary" className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2">
              {(status === "authenticated" || disableLogin) && mounted && (
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
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            {disableLogin ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="border-border text-muted-foreground flex h-8 cursor-default items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium sm:h-10 sm:px-3 sm:text-sm">
                    <ShieldOff className="size-4" />
                    <span className="hidden sm:inline">No-auth mode</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Login is disabled — acting as the local shared user.</p>
                </TooltipContent>
              </Tooltip>
            ) : status === "authenticated" && session?.user ? (
              <Tooltip>
                <DropdownMenu>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button className="border-border hover:border-primary relative flex size-8 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 transition-colors sm:size-10">
                        {session.user.image ? (
                          <Image
                            src={session.user.image}
                            alt={session.user.name || "User"}
                            fill
                            sizes="(max-width: 640px) 32px, 40px"
                            className="object-cover"
                          />
                        ) : (
                          <div className="bg-primary/10 flex size-full items-center justify-center text-sm font-semibold">
                            {session.user.name?.charAt(0).toUpperCase() || "?"}
                          </div>
                        )}
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={handleSignOut}>
                      <LogOut className="mr-2 size-4" />
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
                <LogIn className="mr-2 size-4" />
                <span className="hidden sm:inline">Login</span>
              </Button>
            )}
            {(status === "authenticated" || disableLogin) && mounted && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    asChild
                    variant={pathname === "/settings" ? "default" : "outline"}
                    size="icon"
                    className="size-8 sm:size-10"
                  >
                    <Link href="/settings" aria-label="Settings">
                      <Settings className="size-4" />
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Settings</TooltipContent>
              </Tooltip>
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
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div className="flex shrink-0 items-center gap-2">
        <Button asChild variant={pathname === "/search" ? "default" : "outline"} size="sm">
          <Link href="/search">
            <Search className="mr-2 size-4" />
            Card Search
          </Link>
        </Button>
        <Button asChild variant={pathname === "/scan" ? "default" : "outline"} size="sm">
          <Link href="/scan">
            <Camera className="mr-2 size-4" />
            Scan
          </Link>
        </Button>
        <Button asChild variant={pathname === "/my-cards" ? "default" : "outline"} size="sm">
          <Link href="/my-cards">
            <FolderOpen className="mr-2 size-4" />
            My cards
          </Link>
        </Button>
      </div>

      <OpenCollectionButtons />
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
            className="size-9"
          >
            <Link href="/search">
              <Search className="size-4" />
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
            className="size-9"
          >
            <Link href="/scan">
              <Camera className="size-4" />
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
            className="size-9"
          >
            <Link href="/my-cards">
              <FolderOpen className="size-4" />
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
              <Button variant="outline" size="icon" className="size-9">
                <Menu className="size-4" />
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
