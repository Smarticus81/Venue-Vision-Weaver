import { Router, type IRouter } from "express";
import { buildPublicConfig } from "../lib/publicConfig.js";

const router: IRouter = Router();

// GET /public/config — published prices, trial terms, founding offer, proof
// mode and contact address for the public site. No auth; cached 60s.
router.get("/public/config", async (_req, res): Promise<void> => {
  const config = await buildPublicConfig();
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json(config);
});

export default router;
