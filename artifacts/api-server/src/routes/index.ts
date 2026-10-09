import { Router, type IRouter } from "express";
import healthRouter from "./health";
import publicConfigRouter from "./publicConfig";
import eventsRouter from "./events";
import storageRouter from "./storage";
import venuesRouter from "./venues";
import sessionsRouter from "./sessions";
import galleryStylesRouter from "./galleryStyles";
import billingRouter from "./billing";
import controlPlaneRouter from "./controlPlane";
import controlProspectsRouter from "./controlProspects";
import controlGrowthRouter from "./controlGrowth";
import outreachRouter from "./outreach";
import operatorAccessRouter from "./operatorAccess";

const router: IRouter = Router();

router.use(healthRouter);
router.use(publicConfigRouter); // GET /public/config
router.use(eventsRouter); // POST /events (owner funnel)
router.use(storageRouter);
router.use(venuesRouter);
router.use(sessionsRouter);
router.use(galleryStylesRouter);
router.use(billingRouter);
router.use(controlPlaneRouter); // overview, agents, runs, actions, tasks, audit, policies, campaigns
router.use(controlProspectsRouter); // prospects, outreach emails, vetting, research
router.use(controlGrowthRouter); // /control/growth/*, /control/experiments*, /control/digest/*
router.use(outreachRouter);
router.use(operatorAccessRouter); // GET /operator/access (shows the Control link)

export default router;
