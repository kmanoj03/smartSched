import cors from "cors";
import express from "express";
import routes from "./routes";
import { loadEnv } from "./utils/env";
import { errorHandler, notFoundHandler } from "./utils/errorHandler";
import { requestLogger } from "./utils/requestLogger";

loadEnv();

const app = express();
const port = Number(process.env.PORT ?? 4000);
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:3000";

app.use(
  cors({
    origin: clientOrigin,
    credentials: true
  })
);
app.use(express.json());
app.use(requestLogger);
app.use(routes);
app.use(notFoundHandler);
app.use(errorHandler);

app.listen(port, () => {
  console.log(`API server listening on http://localhost:${port}`);
});
