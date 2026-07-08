export class IdentityError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'IdentityError';
  }
}

export function notFound(message = 'Resource was not found.'): IdentityError {
  return new IdentityError('not_found', 404, message);
}

export function conflict(code: string, message: string): IdentityError {
  return new IdentityError(code, 409, message);
}

export function forbidden(message = 'This action is not allowed.'): IdentityError {
  return new IdentityError('forbidden', 403, message);
}

export function badRequest(code: string, message: string): IdentityError {
  return new IdentityError(code, 400, message);
}
