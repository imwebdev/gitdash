import { NextResponse, type NextRequest } from "next/server";
import { isAllowedHost } from "@/lib/security/host";

export function middleware(req: NextRequest) {
  const host = req.headers.get("host");
  if (!isAllowedHost(host)) {
    return new NextResponse("forbidden host", { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
