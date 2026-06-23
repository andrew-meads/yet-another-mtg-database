import { getAuthSession } from "@/auth";
import { redirect } from "next/navigation";

export default async function SettingsLayout({ children }: React.PropsWithChildren) {
  const session = await getAuthSession();
  if (!session) return redirect("/login");

  return <main className="mx-auto w-full max-w-2xl p-4 md:p-6">{children}</main>;
}
