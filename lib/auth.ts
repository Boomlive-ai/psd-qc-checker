import type { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
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

      // If the token hasn't expired yet, return it as-is.
      if (
        token.accessTokenExpires &&
        Date.now() < token.accessTokenExpires
      ) {
        return token;
      }

      // Token has expired — try to refresh it.
      if (token.refreshToken) {
        return await refreshAccessToken(token);
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

// ---------------------------------------------------------------------------
// Refresh an expired Google access token using the refresh token
// ---------------------------------------------------------------------------

async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: token.refreshToken as string,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("Failed to refresh Google token:", data);
      throw new Error(data.error ?? "Refresh failed");
    }

    return {
      ...token,
      accessToken: data.access_token,
      accessTokenExpires: Date.now() + data.expires_in * 1000,
      // Google may or may not return a new refresh token
      refreshToken: data.refresh_token ?? token.refreshToken,
    };
  } catch (err) {
    console.error("Error refreshing access token:", err);
    return {
      ...token,
      accessToken: undefined,
    };
  }
}
