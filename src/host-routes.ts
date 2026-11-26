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
  const bookings = database.collection("bookings");
  const jsonBody = express.json({ limit: "32kb" });
  const validId = z.string().regex(/^[a-f0-9]{24}$/i);

  // Load one studio for its owner's edit form.
  router.get("/host/listings/:id", requireSession, async (req, res) => {
    const id = validId.safeParse(req.params.id);
    const host = res.locals.host;

    if (!id.success) {
      res.status(400).json({ message: "Invalid studio ID." });
      return;
    }

    const studio = await studios.findOne(
      { _id: new ObjectId(id.data), ownerId: host.id },
      {
        projection: {
          title: 1,
          category: 1,
          hourlyRate: 1,
          securityDeposit: 1,
          maxCapacity: 1,
          location: 1,
          overview: 1,
          amenities: 1,
          imageUrl: 1,
        },
      },
    );

    if (!studio) {
      res.status(404).json({ message: "Studio not found in your listings." });
      return;
    }

    res.set("Cache-Control", "no-store").json({
      studio,
      host: { name: host.name, email: host.email },
    });
  });

  // Reuse the same field validation as Add New Studio.
  // The owner can save other changes without uploading a new photo.
  const editStudioInput = studioInput
    .omit({ requestId: true })
    .partial({ imageUrl: true });

  router.patch("/studios/:id", ...protectWrite, jsonBody, async (req, res) => {
    const id = validId.safeParse(req.params.id);
    const input = editStudioInput.safeParse(req.body);

    if (!id.success) {
      res.status(400).json({ message: "Invalid studio ID." });
      return;
    }

    if (!input.success) {
      const issue = input.error.issues[0];
      res.status(400).json({
        message: `${issue.path.join(".")}: ${issue.message}`,
      });
      return;
    }

    const filter = {
      _id: new ObjectId(id.data),
      ownerId: res.locals.host.id,
    };

    const { imageUrl, ...fields } = input.data;

    // Replace the cover and preserve any additional gallery photos.
    const result = imageUrl
      ? await studios.updateOne(filter, [
          {
            $set: {
              ...Object.fromEntries(
                Object.entries(fields).map(([key, value]) => [
                  key,
                  { $literal: value },
                ]),
              ),
              imageUrl: { $literal: imageUrl },
              gallery: {
                $concatArrays: [
                  [imageUrl],
                  { $slice: [{ $ifNull: ["$gallery", []] }, 1, 2147483647] },
                ],
              },
            },
          },
        ])
      : await studios.updateOne(filter, { $set: fields });

    if (result.matchedCount === 0) {
      res.status(404).json({ message: "Studio not found in your listings." });
      return;
    }

    res.sendStatus(204);
  });

  const bookingInput = z.object({
    studioId: validId,
    start: z.string().datetime(),
    end: z.string().datetime(),
    requestId: z.string().uuid(),
  });

  router.post("/bookings", ...protectWrite, jsonBody, async (req, res) => {
    const input = bookingInput.safeParse(req.body);

    if (!input.success) {
      res.status(400).json({ message: "Choose a studio and valid booking times." });
      return;
    }

    const userId = res.locals.host.id;
    const studioId = new ObjectId(input.data.studioId);
    const start = new Date(input.data.start);
    const end = new Date(input.data.end);

    // A retry of the same submission uses the same MongoDB document ID.
    const bookingId = new ObjectId(
      createHash("sha256")
        .update(`booking:${userId}:${input.data.requestId}`)
        .digest("hex")
        .slice(0, 24),
    );

    if (await bookings.findOne({ _id: bookingId, userId })) {
      res.status(200).json({ id: bookingId });
      return;
    }

    if (start.getTime() <= Date.now() || end <= start) {
      res.status(400).json({
        message: "Choose a future start time and an end time after it.",
      });
      return;
    }

    const studio = await studios.findOne(
      { _id: studioId },
      { projection: { title: 1, hourlyRate: 1 } },
    );

    if (!studio) {
      res.status(404).json({ message: "Studio not found." });
      return;
    }

    const overlap = await bookings.findOne({
      studioId,
      status: "Confirmed",
      start: { $lt: end },
      end: { $gt: start },
    });

    if (overlap) {
      res.status(409).json({
        message: "This studio has a confirmed booking during those hours.",
      });
      return;
    }

    const hours = (end.getTime() - start.getTime()) / 3_600_000;
    const total = Math.round(hours * studio.hourlyRate * 100) / 100;

    await bookings.updateOne(
      { _id: bookingId },
      {
        $setOnInsert: {
          userId,
          studioId,
          studioTitle: studio.title,
          hourlyRate: studio.hourlyRate,
          start,
          end,
          total,
          status: "Pending",
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );

    res.status(201).json({ id: bookingId });
  });

  router.get("/bookings/mine", requireSession, async (_req, res) => {
    const rows = await bookings
      .find({ userId: res.locals.host.id })
      .project({ studioTitle: 1, start: 1, end: 1, total: 1, status: 1 })
      .sort({ start: -1 })
      .toArray();

    res.set("Cache-Control", "no-store").json(rows);
  });

  router.patch("/bookings/:id/cancel", ...protectWrite, async (req, res) => {
    const id = validId.safeParse(req.params.id);

    if (!id.success) {
      res.status(400).json({ message: "Invalid booking ID." });
      return;
    }

    const result = await bookings.updateOne(
      {
        _id: new ObjectId(id.data),
        userId: res.locals.host.id,
        status: "Pending",
      },
      { $set: { status: "Cancelled" } },
    );

    if (!result.matchedCount) {
      res.status(409).json({
        message: "Only your pending bookings can be cancelled. Refresh the page.",
      });
      return;
    }

    res.sendStatus(204);
  });


  return router;
}
