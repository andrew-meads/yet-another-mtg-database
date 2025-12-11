"use client";

import SearchControls from "@/components/card-search-page/SearchControls";
import CardsTable from "@/components/card-search-page/CardsTable";
import CardsList from "@/components/card-search-page/mobile/CardsList";
import SearchResults, { useSearchResults } from "@/components/card-search-page/SearchResults";

function SearchPageContent() {
  const { cards, isLoading, error, searchParams, onSearchChange } = useSearchResults();

  return (
    <div className="h-full flex flex-col gap-6">
      <SearchControls onChange={onSearchChange} initial={searchParams} />

      <div className="hidden md:block">
        <SearchResults.PaginationControls />
      </div>

      <div className="flex-1 min-h-0">
        {/* Mobile: CardsList */}
        <div className="md:hidden">
          <CardsList cards={cards} isLoading={isLoading} error={error} />
        </div>
        
        {/* Desktop: CardsTable */}
        <div className="hidden md:block">
          <CardsTable cards={cards} isLoading={isLoading} error={error} />
        </div>
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
