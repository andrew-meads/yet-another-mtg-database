import MainWorkspace from "@/components/MainWorkspace";
import { authOptions } from "@/auth";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

export default async function MainLayout({ children }: React.PropsWithChildren) {
  const session = await getServerSession(authOptions);
  if (!session) return redirect("/login");

  return (
    <main className="w-full mx-auto p-1 md:p-2">
      <MainWorkspace>{children}</MainWorkspace>
    </main>
  );
}
