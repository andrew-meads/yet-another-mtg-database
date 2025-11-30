"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ModeToggle } from "./ui/ModeToggle";
import { Button } from "@/components/ui/button";
import { Separator } from "./ui/separator";
import OpenCollectionButtons from "./OpenCollectionButtons";
import { useSession, signOut } from "next-auth/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LogIn, LogOut } from "lucide-react";
import Image from "next/image";

export default function AppBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, status } = useSession();

  const handleSignOut = async () => {
    await signOut({ callbackUrl: "/login" });
  };

  const handleSignIn = () => {
    router.push("/login");
  };

  return (
    <header className="bg-background border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-foreground">Yet another MTG Database</h1>
            <nav aria-label="Primary" className="flex items-center gap-2">
              {status === "authenticated" && (
                <>
                  <Button
                    asChild
                    variant={pathname === "/search" ? "default" : "outline"}
                    size="sm"
                  >
                    <Link href="/search">Card Search</Link>
                  </Button>
                  <Button
                    asChild
                    variant={pathname === "/my-cards" ? "default" : "outline"}
                    size="sm"
                  >
                    <Link href="/my-cards">My cards</Link>
                  </Button>

                  <Separator orientation="vertical" className="h-6! bg-foreground/20 mx-1" />

                  <OpenCollectionButtons />
                </>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            {status === "authenticated" && session?.user ? (
              <Tooltip>
                <DropdownMenu>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button className="relative h-10 w-10 rounded-full overflow-hidden border-2 border-border hover:border-primary transition-colors flex items-center justify-center">
                        {session.user.image ? (
                          <Image
                            src={session.user.image}
                            alt={session.user.name || "User"}
                            fill
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
              <Button variant="outline" size="sm" onClick={handleSignIn}>
                <LogIn className="mr-2 h-4 w-4" />
                Login
              </Button>
            )}
            <ModeToggle />
          </div>
        </div>
      </div>
    </header>
  );
}
