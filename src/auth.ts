import "dotenv/config";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import type { Db, MongoClient } from "mongodb";

export function createAuth(database: Db, client: MongoClient) {
  const baseURL = process.env.BETTER_AUTH_URL;
  const secret = process.env.BETTER_AUTH_SECRET;
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!baseURL || !secret) {
    throw new Error("Set BETTER_AUTH_URL and BETTER_AUTH_SECRET in the server .env.");
  }

  if (!googleClientId || !googleClientSecret) {
    throw new Error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the server .env.");
  }

  return betterAuth({
    appName: "JUPITAR STUDIO",
    baseURL,
    secret,
    database: mongodbAdapter(database, { client }),

    socialProviders: {
      google: {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
      },
    },

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 6,
      requireEmailVerification: false,
      autoSignIn: false,
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") return;

        const password = ctx.body?.password;

        if (
          typeof password !== "string" ||
          password.length < 6 ||
          !/[A-Z]/.test(password) ||
          !/[a-z]/.test(password)
        ) {
          throw new APIError("BAD_REQUEST", {
            message:
              "Use at least 6 characters, including one uppercase and one lowercase letter.",
          });
        }
      }),
    },
  });
}
