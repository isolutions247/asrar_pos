import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import categoriesRouter from "./categories";
import menuRouter from "./menu";
import ordersRouter from "./orders";
import customersRouter from "./customers";
import settingsRouter from "./settings";
import backupRouter from "./backup";
import ticketsRouter from "./tickets";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(categoriesRouter);
router.use(menuRouter);
router.use(ordersRouter);
router.use(customersRouter);
router.use(settingsRouter);
router.use(backupRouter);
router.use(ticketsRouter);

export default router;
