import AppBar from "@/components/AppBar";

export default function LayoutWithAppBar({ children }: React.PropsWithChildren) {
  return (
    <div className="min-h-screen bg-background">
      <AppBar />
      {children}
    </div>
  );
}
