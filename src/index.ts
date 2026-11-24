import express from "express";
import { connectToDatabase } from "./db.js";

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

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

async function startServer() {
  const database = await connectToDatabase();
  const studios = database.collection("studios");

  console.log(`MongoDB connection OK: ${database.databaseName}`);

  // Home page: return the six highest-rated studios.
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

  // Explore page: return all studios or filter by category.
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

  app.listen(port, () => {
    console.log(`JUPITAR STUDIO API: http://localhost:${port}/api/health`);
  });
}

startServer().catch(() => {
  console.error(
    "Server startup failed. Check the MongoDB settings in .env and network access in Atlas."
  );
  process.exit(1);
});
