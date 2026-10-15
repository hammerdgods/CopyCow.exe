import { NextResponse, type NextRequest } from "next/server";
import { getProof } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(req: NextRequest) {
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 50)));
  const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset") ?? 0));
  return NextResponse.json(getProof(limit, offset));
}
