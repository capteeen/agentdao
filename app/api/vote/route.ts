import { NextResponse } from "next/server";

// Phase 2 endpoint (STUB). See lib/phase2/* and README.
export async function POST() {
  return NextResponse.json({ error: "Phase 2 backend not enabled: /api/vote is a stub. Set NEXT_PUBLIC_BOSS_BACKEND=sim." }, { status: 501 });
}
