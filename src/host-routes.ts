import express, { type RequestHandler } from "express";
import cookieParser from "cookie-parser";
import { fromNodeHeaders } from "better-auth/node";
import { SignJWT, jwtVerify } from "jose";
import { ObjectId, type Db } from "mongodb";
import { z } from "zod";
import { createHash } from "node:crypto";
import type { createAuth } from "./auth.js";

type Auth = ReturnType<typeof createAuth>;

const categories = ["photo", "film", "podcast", "music", "workshop"] as const;
const tokenCookie = "jupitar_api";
const issuer = "jupitar-studio";
const audience = "jupitar-api";

const studioInput = z.object({
  title: z.string().trim().min(1).max(120),
  category: z.enum(categories),
  hourlyRate: z.number().positive(),
  securityDeposit: z.number().nonnegative(),
  maxCapacity: z.number().int().positive(),
  location: z.string().trim().min(1).max(250),
  overview: z.string().trim().min(1).max(5000),
  amenities: z.array(z.string().trim().min(1).max(80)).max(40),
  imageUrl: z.string().url().refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname === "i.ibb.co";
    } catch {
      return false;
    }
  }, "Upload a studio image before publishing."),
  requestId: z.string().uuid(),
});

export function createHostRoutes(database: Db, auth: Auth) {
  const router = express.Router();
  const studios = database.collection("studios");
  const baseURL = process.env.BETTER_AUTH_URL;
  const secret = process.env.BETTER_AUTH_SECRET;

  if (!baseURL || !secret) {
    throw new Error("Missing Better Auth environment settings.");
  }

  const appOrigin = new URL(baseURL).origin;
  const signingKey = createHash("sha256")
    .update("jupitar-api-jwt/v1\0")
    .update(secret)
    .digest();

  const requireSession: RequestHandler = async (req, res, next) => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      res.status(401).json({ message: "Please log in to continue." });
      return;
    }

    res.locals.host = {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      sessionId: session.session.id,
    };
    next();
  };

  const requireAppOrigin: RequestHandler = (req, res, next) => {
    if (req.get("origin") !== appOrigin) {
      res.status(403).json({ message: "Request origin is not allowed." });
      return;
    }
    next();
  };

  const requireToken: RequestHandler = async (req, res, next) => {
    try {
      const token = req.cookies?.[tokenCookie];
      if (typeof token !== "string") throw new Error();

      const { payload } = await jwtVerify(token, signingKey, {
        issuer,
        audience,
        algorithms: ["HS256"],
      });

      const host = res.locals.host;
      if (payload.sub !== host.id || payload.sid !== host.sessionId) {
        throw new Error();
      }
    } catch {
      res.status(401).json({ message: "Your API session has expired." });
      return;
    }
    next();
  };

  router.use(cookieParser());

  router.post("/host/session", requireSession, requireAppOrigin, async (_req, res) => {
    const host = res.locals.host;

    const token = await new SignJWT({ sid: host.sessionId })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(host.id)
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(signingKey);

    res.cookie(tokenCookie, token, {
      httpOnly: true,
      secure: new URL(baseURL).protocol === "https:",
      sameSite: "lax",
      path: "/api",
      maxAge: 10 * 60 * 1000,
    });
    res.set("Cache-Control", "no-store").sendStatus(204);
  });

  router.get("/host/listings", requireSession, async (_req, res) => {
    const host = res.locals.host;

    const listings = await studios
      .find({ ownerId: host.id })
      .project({ title: 1, location: 1, hourlyRate: 1, category: 1 })
      .sort({ createdAt: -1, _id: -1 })
      .toArray();

    res.set("Cache-Control", "no-store").json({
      host: { name: host.name, email: host.email },
      listings,
    });
  });

  const protectWrite = [requireSession, requireAppOrigin, requireToken];

  router.post(
    "/host/images",
    ...protectWrite,
    express.raw({ type: ["image/png", "image/jpeg"], limit: "5mb" }),
    async (req, res) => {
      const key = process.env.IMGBB_API_KEY;
      if (!key) {
        res.status(503).json({ message: "Studio image uploads are not configured." });
        return;
      }

      const file = req.body;
      const isPng = Buffer.isBuffer(file) &&
        file.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
      const isJpeg = Buffer.isBuffer(file) &&
        file.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"));

      if (!isPng && !isJpeg) {
        res.status(400).json({ message: "Choose a PNG or JPEG image." });
        return;
      }

      try {
        const upload = new FormData();
        upload.set("key", key);
        upload.set("image", file.toString("base64"));

        const result = await fetch("https://api.imgbb.com/1/upload", {
          method: "POST",
          body: upload,
          signal: AbortSignal.timeout(30000),
        });

        const data = await result.json();
        if (!result.ok || !data.success || typeof data.data?.url !== "string") {
          throw new Error();
        }

        res.status(201).json({ imageUrl: data.data.url });
      } catch {
        res.status(502).json({ message: "Image upload failed. Please try again." });
      }
    },
  );

  router.post(
    "/studios",
    ...protectWrite,
    express.json({ limit: "32kb" }),
    async (req, res) => {
      const parsed = studioInput.safeParse(req.body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        res.status(400).json({ message: `${issue.path.join(".")}: ${issue.message}` });
        return;
      }

      const { requestId, ...fields } = parsed.data;
      const host = res.locals.host;

      // Retrying the same form submission should create only one listing.
      const id = new ObjectId(
        createHash("sha256").update(`${host.id}:${requestId}`).digest("hex").slice(0, 24),
      );

      const result = await studios.updateOne(
        { _id: id, ownerId: host.id },
        {
          $setOnInsert: {
            ...fields,
            ownerId: host.id,
            ownerName: host.name,
            ownerEmail: host.email,
            gallery: [fields.imageUrl],
            reviews: [],
            rating: 0,
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );

      res.status(result.upsertedCount ? 201 : 200).json({ id: id.toHexString() });
    },
  );

  router.delete("/studios/:id", ...protectWrite, async (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string" || !/^[a-f\d]{24}$/i.test(id)) {
      res.status(400).json({ message: "Invalid studio ID." });
      return;
    }

    const result = await studios.deleteOne({
      _id: new ObjectId(id),
      ownerId: res.locals.host.id,
    });

    if (result.deletedCount === 0) {
      res.status(404).json({ message: "This listing was not found in your account." });
      return;
    }

    res.sendStatus(204);
  });

  return router;
}
