import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import staffRouter from "./staff";
import notificationRouter from "./notifications";
import syncRouter from "./sync";
import systemRouter from "./system";
import entityRouter from "./entities";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(staffRouter);
router.use(notificationRouter);
router.use(syncRouter);
router.use(systemRouter);
router.use(entityRouter);

export default router;
