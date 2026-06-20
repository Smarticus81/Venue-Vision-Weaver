import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storageRouter from "./storage";
import venuesRouter from "./venues";
import sessionsRouter from "./sessions";
import galleryStylesRouter from "./galleryStyles";
import billingRouter from "./billing";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(venuesRouter);
router.use(sessionsRouter);
router.use(galleryStylesRouter);
router.use(billingRouter);

export default router;
