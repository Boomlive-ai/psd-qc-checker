/** Result of validating a single PSD file. */
export interface ValidationResult {
  fileName: string;
  source: "local" | "drive";
  isPsd: boolean;
  width?: number;
  height?: number;
  mp?: number;
  totalLayers?: number;
  artLayers?: number;
  preferred16MP?: boolean;
  pass: boolean;
  reasons: string[];
}

/** Extend the NextAuth session to include the Google access token. */
declare module "next-auth" {
  interface Session {
    accessToken?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
  }
}
