export class HttpError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = status >= 400 && status < 500;
  }
}

export function badRequest(code, message, details) {
  return new HttpError(400, code, message, details);
}

export function notFound(message = "Resource not found") {
  return new HttpError(404, "NOT_FOUND", message);
}

export function conflict(code, message) {
  return new HttpError(409, code, message);
}

export function tooManyRequests(code, message) {
  return new HttpError(429, code, message);
}

export function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}
