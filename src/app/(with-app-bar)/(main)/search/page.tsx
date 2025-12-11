"use client";

import SearchControls from "@/components/card-search-page/SearchControls";
import CardsTable from "@/components/card-search-page/CardsTable";
import CardsList from "@/components/card-search-page/mobile/CardsList";
import SearchResults, { useSearchResults } from "@/components/card-search-page/SearchResults";
import { useIsDesktop } from "@/hooks/useIsDesktop";

function SearchPageContent() {
  const { cards, isLoading, error, searchParams, onSearchChange } = useSearchResults();
  const isDesktop = useIsDesktop();

  return (
    <div className="h-full flex flex-col gap-6">
      <SearchControls onChange={onSearchChange} initial={searchParams} />

      {isDesktop && (
        <div>
          <SearchResults.PaginationControls />
        </div>
      )}

      <div className="flex-1 min-h-0">
        {isDesktop ? (
          <CardsTable cards={cards} isLoading={isLoading} error={error} />
        ) : (
          <CardsList cards={cards} isLoading={isLoading} error={error} />
        )}
      </div>

      <SearchResults.PaginationControls />
    </div>
  );
}

export default function SearchPage() {
  return (
    <SearchResults>
      <SearchPageContent />
    </SearchResults>
  );
}
