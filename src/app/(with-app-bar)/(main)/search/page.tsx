"use client";

import SearchControls from "@/components/card-search-page/SearchControls";
import CardsTable from "@/components/card-search-page/CardsTable";
import CardsList from "@/components/card-search-page/mobile/CardsList";
import SearchResults, { useSearchResults } from "@/components/card-search-page/SearchResults";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import InfiniteScrollSearchResults, {
  useInfiniteScrollSearchResults
} from "@/components/card-search-page/InfiniteScrollSearchResults";
import CardsInfiniteList from "@/components/card-search-page/mobile/CardsInfiniteList";

function DesktopSearchPageContent() {
  const { cards, isLoading, error, searchParams, onSearchChange } = useSearchResults();

  return (
    <div className="h-full flex flex-col gap-6">
      <SearchControls onChange={onSearchChange} initial={searchParams} />

      <SearchResults.PaginationControls />

      <div className="flex-1 min-h-0">
        <CardsTable cards={cards} isLoading={isLoading} error={error} />
      </div>

      <SearchResults.PaginationControls />
    </div>
  );
}

function MobileSearchPageContent() {
  const {
    cardPages,
    isLoading,
    error,
    searchParams,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    onSearchChange
  } = useInfiniteScrollSearchResults();
  return (
    <div className="h-full flex flex-col gap-6">
      <SearchControls onChange={onSearchChange} initial={searchParams} />

      <div className="flex-1 min-h-0">
        <CardsInfiniteList
          cardPages={cardPages}
          isLoading={isLoading}
          error={error}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          fetchNextPage={fetchNextPage}
        />
      </div>
    </div>
  );
}

export default function SearchPage() {
  const { isDesktop } = useIsDesktop();

  if (isDesktop) {
    return (
      <SearchResults>
        <DesktopSearchPageContent />
      </SearchResults>
    );
  }

  return (
    <InfiniteScrollSearchResults>
      <MobileSearchPageContent />
    </InfiniteScrollSearchResults>
  );
}
