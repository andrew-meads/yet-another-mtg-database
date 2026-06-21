import NextAuth, { NextAuthOptions, getServerSession } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
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
    })
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
    async signIn({ user }) {
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
 * sign-in callback and the no-auth-mode provisioning below.
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

// --- No-auth ("DISABLE_LOGIN") mode -----------------------------------------

/** Fixed user the app acts as when login is disabled. */
export const NO_AUTH_USER_ID = "000000000000000000000001";

/** True when the app is configured to run without authentication. */
export function isLoginDisabled(): boolean {
  return process.env.DISABLE_LOGIN === "true";
}

/** Synthetic session used everywhere a real one would be read in no-auth mode. */
export const noAuthSession: Session = {
  user: {
    _id: NO_AUTH_USER_ID,
    name: "No-auth mode",
    email: "noauth@localhost",
    image: null
  },
  // Far-future expiry so nothing treats the session as stale.
  expires: "9999-12-31T23:59:59.999Z"
};

// Memoize provisioning so it runs at most once per server process.
let provisioned: Promise<void> | null = null;

/**
 * Idempotently ensure the fixed no-auth user exists and owns an active
 * "Main Collection". Mirrors the auto-create behaviour of the sign-in callback.
 */
function ensureNoAuthUser(): Promise<void> {
  if (!provisioned) {
    provisioned = (async () => {
      await connectDb();
      await UserModel.updateOne(
        { _id: NO_AUTH_USER_ID },
        { $setOnInsert: { emailAddress: "noauth@localhost" } },
        { upsert: true }
      );
      await ensureMainCollection(NO_AUTH_USER_ID);
    })().catch((error) => {
      // Reset so a later request can retry after a transient failure.
      provisioned = null;
      throw error;
    });
  }
  return provisioned;
}

/**
 * Return the current session. In no-auth mode this is a synthetic session for
 * the fixed {@link NO_AUTH_USER_ID} (provisioning that user on first use);
 * otherwise it delegates to NextAuth's {@link getServerSession}.
 */
export async function getAuthSession(): Promise<Session | null> {
  if (isLoginDisabled()) {
    await ensureNoAuthUser();
    return noAuthSession;
  }
  return getServerSession(authOptions);
}
