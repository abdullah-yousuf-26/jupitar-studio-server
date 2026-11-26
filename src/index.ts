import express from "express";
import { ObjectId } from "mongodb";
import { toNodeHandler } from "better-auth/node";

import { createAuth } from "./auth.js";
import { client, connectToDatabase } from "./db.js";
import { createHostRoutes } from "./host-routes.js";

const app = express();
const port = Number(process.env.PORT ?? 5000);

const studioCategories = ["photo", "film", "podcast", "music", "workshop"];

const studioCardFields = {
  _id: 1,
  title: 1,
  category: 1,
  location: 1,
  hourlyRate: 1,
  rating: 1,
  imageUrl: 1,
};

const studioDetailFields = {
  ...studioCardFields,
  overview: 1,
  amenities: 1,
  securityDeposit: 1,
  maxCapacity: 1,
  ownerName: 1,
  gallery: 1,
  reviews: 1,
};

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

async function startServer() {
  const database = await connectToDatabase();
  const studios = database.collection("studios");
  const auth = createAuth(database, client);

  console.log(`MongoDB connection OK: ${database.databaseName}`);

  app.all("/api/auth/*splat", toNodeHandler(auth));
  app.use("/api", createHostRoutes(database, auth));

  // Register named studio routes before the dynamic /:id route.
  app.get("/api/studios/featured", async (_request, response) => {
    try {
      const featuredStudios = await studios
        .find({})
        .project(studioCardFields)
        .sort({ rating: -1, _id: 1 })
        .limit(6)
        .toArray();

      response.json(featuredStudios);
    } catch (error) {
      console.error("Failed to load featured studios:", error);
      response.status(500).json({
        message: "Featured studios could not be loaded.",
      });
    }
  });

  app.get("/api/studios", async (request, response) => {
    const category = request.query.category;

    if (
      category !== undefined &&
      (typeof category !== "string" || !studioCategories.includes(category))
    ) {
      response.status(400).json({
        message: "Choose a valid studio category.",
      });
      return;
    }

    const filter = category === undefined ? {} : { category };

    try {
      const matchingStudios = await studios
        .find(filter)
        .project(studioCardFields)
        .sort({ title: 1, _id: 1 })
        .toArray();

      response.json(matchingStudios);
    } catch (error) {
      console.error("Failed to load studios:", error);
      response.status(500).json({
        message: "Studios could not be loaded.",
      });
    }
  });

  app.get("/api/studios/:id", async (request, response) => {
    const { id } = request.params;

    if (!/^[0-9a-f]{24}$/i.test(id)) {
      response.status(400).json({ message: "Invalid studio ID." });
      return;
    }

    try {
      const studio = await studios.findOne(
        { _id: new ObjectId(id) },
        { projection: studioDetailFields },
      );

      if (!studio) {
        response.status(404).json({ message: "Studio not found." });
        return;
      }

      const gallery =
        Array.isArray(studio.gallery) && studio.gallery.length > 0
          ? studio.gallery
          : studio.imageUrl
            ? [studio.imageUrl]
            : [];

      response.json({
        ...studio,
        gallery,
        reviews: studio.reviews ?? [],
      });
    } catch (error) {
      console.error("Failed to load studio details:", error);
      response.status(500).json({
        message: "Studio details could not be loaded.",
      });
    }
  });

  app.listen(port, () => {
    console.log(`JUPITAR STUDIO API: http://localhost:${port}/api/health`);
  });
}

startServer().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  console.error("JUPITAR STUDIO server failed to start:", message);
  process.exit(1);
});
