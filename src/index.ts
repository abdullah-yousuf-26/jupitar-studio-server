import express from "express";
import { connectToDatabase } from "./db.js";

const app = express();
const port = Number(process.env.PORT ?? 5000);

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

async function startServer() {
  const database = await connectToDatabase();

  app.get("/api/studios/featured", async (_request, response) => {
    try {
      const studios = await database
        .collection("studios")
        .find({})
        .project({
          _id: 1,
          title: 1,
          category: 1,
          location: 1,
          hourlyRate: 1,
          rating: 1,
          imageUrl: 1,
        })
        .sort({ rating: -1, _id: 1 })
        .limit(6)
        .toArray();

      response.json(studios);
    } catch (error) {
      console.error("Failed to load featured studios:", error);
      response.status(500).json({
        message: "Featured studios could not be loaded.",
      });
    }
  });


  console.log(`MongoDB connection OK: ${database.databaseName}`);

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
