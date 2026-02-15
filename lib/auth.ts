import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import db from "@/lib/db";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const BETTER_AUTH_BASE_URL =
  process.env.BETTER_AUTH_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;

export const auth = betterAuth({
  appName: "Treehacks",
  baseURL: BETTER_AUTH_BASE_URL,
  database: prismaAdapter(db, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders:
    GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: GOOGLE_CLIENT_ID,
            clientSecret: GOOGLE_CLIENT_SECRET,
          },
        }
      : undefined,
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
  },
});
