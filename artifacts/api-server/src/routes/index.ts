import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import staffRouter from "./staff";
import notificationRouter from "./notifications";
import syncRouter from "./sync";
import systemRouter from "./system";
import entityRouter from "./entities";
import fileRouter from "./files";
import aiRouter from "./ai";
import propertyRouter from "./property";
import publicAccessRouter from "./publicAccess";
import organizationsRouter from "./organizations";
import scoresRouter from "./scores";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(organizationsRouter);
router.use(publicAccessRouter);
router.use(staffRouter);
router.use(notificationRouter);
router.use(syncRouter);
router.use(systemRouter);
router.use(scoresRouter);
router.use(entityRouter);
router.use(fileRouter);
router.use(aiRouter);
router.use(propertyRouter);

export default router;
