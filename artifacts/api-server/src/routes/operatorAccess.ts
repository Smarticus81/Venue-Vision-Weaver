import { Router, type IRouter } from "express";
import { isOperatorRequest } from "../control-plane/operatorAuth.js";

/**
 * GET /operator/access — lets the web app show the Control link only to
 * operators. It never refuses: anonymous callers and non-operators get
 * { operator: false }. Every /control route still runs requireOperator.
 */
const router: IRouter = Router();

router.get("/operator/access", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ operator: await isOperatorRequest(req) });
});

export default router;
