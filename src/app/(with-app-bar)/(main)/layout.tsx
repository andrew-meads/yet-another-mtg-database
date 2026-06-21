import MainWorkspace from "@/components/MainWorkspace";
import { getAuthSession } from "@/auth";
import { redirect } from "next/navigation";

export default async function MainLayout({ children }: React.PropsWithChildren) {
  const session = await getAuthSession();
  if (!session) return redirect("/login");

  return (
    <main className="mx-auto w-full p-1 md:p-2">
      <MainWorkspace>{children}</MainWorkspace>
    </main>
  );
}
