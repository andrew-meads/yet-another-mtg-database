"use client";

import { createContext, useContext, useState } from "react";
import { ScanResponse } from "@/types/ScanResult";

interface ScanContextType {
  scanResult: ScanResponse | null;
  setScanResult: (result: ScanResponse | null) => void;
}

const ScanContext = createContext<ScanContextType>({
  scanResult: null,
  setScanResult: () => {}
});

export function ScanContextProvider({ children }: { children: React.ReactNode }) {
  const [scanResult, setScanResult] = useState<ScanResponse | null>(null);

  return (
    <ScanContext.Provider value={{ scanResult, setScanResult }}>{children}</ScanContext.Provider>
  );
}

export function useScanContext() {
  return useContext(ScanContext);
}
