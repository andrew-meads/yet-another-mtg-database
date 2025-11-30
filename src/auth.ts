import NextAuth, { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import type { DefaultSession } from "next-auth";
import connectDb from "@/db/mongoose";
import { UserModel } from "@/db/schema";

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

        if (!existingUser) {
          // User not found in database, reject sign-in
          return false;
        }

        // Store the database _id in the user object
        user._id = existingUser._id.toString();
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
