export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, code = "INTERNAL_SERVER_ERROR", statusCode = 500) {
    super(message);
    this.name = "HttpError";
    this.code = code;
    this.statusCode = statusCode;
  }
}
