import NextAuth, { NextAuthOptions, getServerSession } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import type { DefaultSession, Session } from "next-auth";
import connectDb from "@/db/mongoose";
import { UserModel, CollectionModel } from "@/db/schema";

// Extend NextAuth types to include user._id
declare module "next-auth" {
  interface Session {
    user: {
      _id: string;
    } & DefaultSession["user"];
  }
  interface User {
    _id?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    _id?: string;
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!
    }),
    // Dev-only login (see isDevLoginEnabled below). The spread is evaluated once
    // at module load: the provider either exists for the process or it doesn't.
    ...(isDevLoginEnabled()
      ? [
          CredentialsProvider({
            id: "dev-login",
            name: "Dev user",
            credentials: {},
            authorize: () => provisionDevUser()
          })
        ]
      : [])
  ],
  pages: {
    signIn: "/login",
    error: "/login" // Redirect errors back to your custom login page
  },
  session: {
    strategy: "jwt" // Use JWT sessions (no database needed)
  },
  callbacks: {
    // Check if user exists in database on sign-in
    async signIn({ user, account }) {
      // Dev login: authorize() already provisioned the user; skip the whitelist.
      if (account?.provider === "dev-login") return true;

      if (!user.email) {
        return false; // Reject if no email
      }

      try {
        await connectDb();
        const existingUser = await UserModel.findOne({ emailAddress: user.email });

        if (!existingUser) return false;

        // Store the database _id in the user object
        user._id = existingUser._id.toString();

        // Create a default, active collection for this user if they have none
        // (active so that search → deck drops work out of the box).
        await ensureMainCollection(existingUser._id);

        return true;
      } catch (error) {
        console.error("Error during sign-in:", error);
        return false;
      }
    },
    // Add user info to the JWT token
    async jwt({ token, user }) {
      if (user?._id) {
        token._id = user._id; // This is the database _id from signIn callback
      }
      return token;
    },
    // Add user info to the session object
    async session({ session, token }) {
      if (session.user && token._id) {
        session.user._id = token._id as string; // This is the database _id
      }
      return session;
    }
  }
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };

/**
 * Create a default, active "Main Collection" for the given owner if they have none
 * (active so that search → deck drops work out of the box). Shared by the Google
 * sign-in callback and the dev-login provisioning below.
 */
async function ensureMainCollection(owner: string) {
  const numCollections = await CollectionModel.countDocuments({ owner });
  if (numCollections === 0) {
    await CollectionModel.create({
      name: "Main Collection",
      description: "My main MTG card collection",
      isActive: true,
      owner
    });
  }
}

// --- Dev login ("AUTH_DEV_LOGIN") --------------------------------------------

/** Fixed dev user id (kept from the old no-auth mode so local data survives). */
export const DEV_USER_ID = "000000000000000000000001";
export const DEV_USER_EMAIL = "dev@localhost";

/** True when the dev-only Credentials provider is registered. Never in production. */
export function isDevLoginEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.AUTH_DEV_LOGIN === "true";
}

/**
 * Idempotently ensure the fixed dev user exists and owns an active
 * "Main Collection" (mirroring the Google sign-in auto-create), then return
 * the NextAuth user for the session.
 */
export async function provisionDevUser() {
  await connectDb();
  await UserModel.updateOne(
    { _id: DEV_USER_ID },
    { $setOnInsert: { emailAddress: DEV_USER_EMAIL } },
    { upsert: true }
  );
  await ensureMainCollection(DEV_USER_ID);
  return { id: DEV_USER_ID, _id: DEV_USER_ID, name: "Dev User", email: DEV_USER_EMAIL };
}

/** Return the current session. The single seam every page/route reads through. */
export async function getAuthSession(): Promise<Session | null> {
  return getServerSession(authOptions);
}
