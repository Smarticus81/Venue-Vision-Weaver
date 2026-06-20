import { Router, type IRouter } from "express";
import { listPublicGalleryStyles } from "../lib/galleryStyles.js";

const router: IRouter = Router();

router.get("/gallery-styles", (_req, res) => {
  res.json({ styles: listPublicGalleryStyles() });
});

export default router;
