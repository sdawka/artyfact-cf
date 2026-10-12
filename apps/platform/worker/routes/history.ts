import { Hono } from "hono";
import type { HistoryResponse } from "../../shared/api";
import { systemStub } from "../service";
import type { AppEnv } from "./app";

export const history = new Hono<AppEnv>().get("/systems/:id/history", async (c) =>
  c.json<HistoryResponse>({ commits: await systemStub(c.env, c.req.param("id")).history() }));
