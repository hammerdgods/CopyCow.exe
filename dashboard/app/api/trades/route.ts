import { NextResponse } from "next/server";
import { getClosedTrades } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(getClosedTrades());
}
