import { Hono } from "hono";
import { channel } from "./channels/github.ts";

const app = new Hono();

app.get("/health", (context) => context.json({ status: "ok" }));
app.route("/channels/github", channel.route());

export default app;
