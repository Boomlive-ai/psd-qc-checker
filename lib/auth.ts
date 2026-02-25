import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import "@/lib/types"; // augment Session & JWT types

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/drive.readonly",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],

  callbacks: {
    async jwt({ token, account }) {
      // On initial sign-in, persist the Google tokens in the JWT.
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.accessTokenExpires = account.expires_at
          ? account.expires_at * 1000
          : undefined;
      }
      return token;
    },

    async session({ session, token }) {
      // Expose the access token to the client via the session.
      session.accessToken = token.accessToken as string | undefined;
      return session;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};
