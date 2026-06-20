import AppBar from "@/components/AppBar";

export default function LayoutWithAppBar({ children }: React.PropsWithChildren) {
  return (
    <div className="bg-background min-h-screen">
      <AppBar />
      {children}
    </div>
  );
}
