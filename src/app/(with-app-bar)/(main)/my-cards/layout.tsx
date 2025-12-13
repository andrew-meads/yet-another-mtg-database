"use client";

import OpenCollectionButtons from "@/components/OpenCollectionButtons";
import { useIsDesktop } from "@/hooks/useIsDesktop";

export default function MyCardsLayout({ children }: React.PropsWithChildren) {
  const { isDesktop, mounted } = useIsDesktop();

  return (
    <div className="flex-1 p-1 h-full">
      {mounted && isDesktop && (
        <div className="flex gap-2 mb-2">
          <OpenCollectionButtons />
        </div>
      )}
      {children}
    </div>
  );
}
