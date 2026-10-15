import { NextResponse } from "next/server";
import { getPerformance } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(getPerformance());
}
