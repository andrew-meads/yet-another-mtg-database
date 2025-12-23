import type { Metadata } from "next";
import { Roboto, Fira_Code } from "next/font/google";
import "./globals.css";
import { Providers } from "@/context/Providers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { Toaster } from "sonner";

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"]
});

const firaCode = Fira_Code({
  variable: "--font-fira-code",
  subsets: ["latin"]
});

export const metadata: Metadata = {
  title: "Yet Another MTG Database",
  description: "Magic: The Gathering card database and collection manager"
};

export default async function RootLayout({ children }: Readonly<React.PropsWithChildren>) {
  const session = await getServerSession(authOptions);

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${roboto.variable} ${firaCode.variable} antialiased`}>
        <Providers session={session}>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
