import { NextResponse } from "next/server";

export class AdminAccessDeniedError extends Error {
  /** 401 for anonymous callers, 403 for authenticated non-admins. */
  readonly status: 401 | 403;

  constructor(status: 401 | 403 = 403) {
    super(status === 401 ? "Authentication required" : "Admin privileges required");
    this.name = "AdminAccessDeniedError";
    this.status = status;
  }
}

/** Shared catch-block mapper: 401/403 response for an admin denial, else null. */
export function adminDeniedResponse(error: unknown): NextResponse | null {
  if (!(error instanceof AdminAccessDeniedError)) return null;
  return NextResponse.json(
    { success: false, error: error.message },
    { status: error.status },
  );
}
