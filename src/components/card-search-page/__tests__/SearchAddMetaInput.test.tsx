import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { SearchAddMetaProvider, useSearchAddMeta } from "@/context/SearchAddMetaContext";
import SearchAddMetaInput from "@/components/card-search-page/SearchAddMetaInput";

vi.mock("@/hooks/react-query/useRetrieveTags", () => ({
  useRetrieveTags: () => ({ data: ["foil", "signed", "commander"] })
}));

function renderInput() {
  return render(
    <SearchAddMetaProvider>
      <SearchAddMetaInput />
    </SearchAddMetaProvider>
  );
}

describe("SearchAddMetaInput", () => {
  it("renders notes and tags inputs", () => {
    renderInput();
    expect(screen.getByPlaceholderText("e.g. signed, altered...")).toBeInTheDocument();
    expect(screen.getByText("Notes (applied on add)")).toBeInTheDocument();
    expect(screen.getByText("Tags (applied on add)")).toBeInTheDocument();
  });

  it("renders finish and condition pickers showing the defaults", () => {
    renderInput();
    expect(screen.getByText("Finish & condition (applied on add)")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Finish" })).toHaveTextContent("Non-foil");
    expect(screen.getByRole("combobox", { name: "Condition" })).toHaveTextContent("NM");
  });

  it("updates notes in the context when the user types", () => {
    let captured = { notes: "", tags: [] as string[] };
    function Inspector() {
      const ctx = useSearchAddMeta();
      captured = ctx;
      return null;
    }

    render(
      <SearchAddMetaProvider>
        <SearchAddMetaInput />
        <Inspector />
      </SearchAddMetaProvider>
    );

    fireEvent.change(screen.getByPlaceholderText("e.g. signed, altered..."), {
      target: { value: "signed" }
    });

    expect(captured.notes).toBe("signed");
  });
});
