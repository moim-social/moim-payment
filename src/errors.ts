export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function badRequest(code: string, message: string): AppError {
  return new AppError(400, code, message);
}

export function unauthorized(): AppError {
  return new AppError(401, "unauthorized", "Unauthorized");
}

export function notFound(code = "not_found", message = "Not found"): AppError {
  return new AppError(404, code, message);
}

export function conflict(code: string, message: string): AppError {
  return new AppError(409, code, message);
}
