import type { Request, Response } from "express";

export const notImplemented = (_req: Request, res: Response): void => {
  res.status(501).json({
    error: {
      message: "Not implemented yet",
      code: "NOT_IMPLEMENTED"
    }
  });
};
