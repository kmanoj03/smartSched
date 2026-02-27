import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./httpError";

export const notFoundHandler = (req: Request, _res: Response, next: NextFunction): void => {
  next(new HttpError(`Route not found: ${req.method} ${req.originalUrl}`, "NOT_FOUND", 404));
};

export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const normalized =
    err instanceof HttpError
      ? err
      : new HttpError("Something went wrong", "INTERNAL_SERVER_ERROR", 500);

  res.status(normalized.statusCode).json({
    error: {
      message: normalized.message,
      code: normalized.code
    }
  });
};
