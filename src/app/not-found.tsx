import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { NOUGHTY_NAME } from "@/lib/easterEggs";

/**
 * Global 404 page (Next `not-found` convention). Unmatched URLs render it in the
 * root layout alone (no app bar), so it also serves signed-out visitors and the
 * home link routes them to login or search. `notFound()` thrown from a nested page
 * (an unknown collection/deck id) renders it inside the `(with-app-bar)` layout, so
 * the min-height leaves room for the app bar rather than assuming the full screen.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-6 p-6 text-center">
      <Image
        src="/noughty-404.png"
        alt={`${NOUGHTY_NAME}, the app mascot, happily eating a torn web page`}
        width={1536}
        height={1024}
        priority
        sizes="(max-width: 640px) 90vw, 32rem"
        className="h-auto w-full max-w-lg"
      />
      <div className="space-y-2">
        <p className="text-muted-foreground text-sm font-semibold tracking-widest uppercase">404</p>
        <h1 className="text-3xl font-bold">Noughty ate this page</h1>
        <p className="text-muted-foreground max-w-md">
          Whatever used to be here has been thoroughly devoured. Check the address, or head back
          somewhere that still exists.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button asChild size="lg">
          <Link href="/">Take me home</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/my-cards">My cards</Link>
        </Button>
      </div>
    </main>
  );
}
