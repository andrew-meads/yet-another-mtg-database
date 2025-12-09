import AppBar from "@/components/AppBar";

export default function LayoutWithAppBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <AppBar />
      {children}
    </div>
  );
}
