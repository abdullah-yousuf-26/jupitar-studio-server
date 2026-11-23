import express from "express";

const app = express();
const port = Number(process.env.PORT ?? 5000);

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.listen(port, () => {
  console.log(`JUPITAR STUDIO API: http://localhost:${port}/api/health`);
});