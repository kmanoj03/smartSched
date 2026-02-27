import type { Request, Response } from "express";

export const getHealth = (_req: Request, res: Response): void => {
  res.json({ status: "ok" });
};
