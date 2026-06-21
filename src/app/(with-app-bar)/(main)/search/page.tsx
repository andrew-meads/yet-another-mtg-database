"use client";

import SearchControls from "@/components/card-search-page/SearchControls";
import CardsTable from "@/components/card-search-page/CardsTable";
import SearchResults, { useSearchResults } from "@/components/card-search-page/SearchResults";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import InfiniteScrollSearchResults, {
  useInfiniteScrollSearchResults
} from "@/components/card-search-page/InfiniteScrollSearchResults";
import CardsInfiniteList from "@/components/card-search-page/mobile/CardsInfiniteList";
import { SearchAddMetaProvider } from "@/context/SearchAddMetaContext";
import SearchAddMetaInput from "@/components/card-search-page/SearchAddMetaInput";

function DesktopSearchPageContent() {
  const { cards, isLoading, error, searchParams, onSearchChange } = useSearchResults();

  return (
    <div className="flex h-full flex-col gap-6">
      <SearchControls onChange={onSearchChange} initial={searchParams} />
      <SearchAddMetaInput />

      <SearchResults.PaginationControls />

      <div className="min-h-0 flex-1">
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
    <div className="flex h-full flex-col gap-6">
      <SearchControls onChange={onSearchChange} initial={searchParams} />
      <SearchAddMetaInput />

      <div className="min-h-0 flex-1">
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
      <SearchAddMetaProvider>
        <SearchResults>
          <DesktopSearchPageContent />
        </SearchResults>
      </SearchAddMetaProvider>
    );
  }

  return (
    <SearchAddMetaProvider>
      <InfiniteScrollSearchResults>
        <MobileSearchPageContent />
      </InfiniteScrollSearchResults>
    </SearchAddMetaProvider>
  );
}
