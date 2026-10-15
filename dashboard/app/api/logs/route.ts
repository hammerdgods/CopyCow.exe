import { NextResponse } from "next/server";
import { getLogs } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(getLogs());
}
