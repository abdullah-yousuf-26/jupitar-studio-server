import express from "express";
import { connectToDatabase } from "./db.js";

const app = express();
const port = Number(process.env.PORT ?? 5000);

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

async function startServer() {
  const database = await connectToDatabase();
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
