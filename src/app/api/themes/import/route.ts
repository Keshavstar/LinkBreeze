import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { demoBlock } from "@/lib/demo";
import { importTheme } from "@/server/actions/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Import a previously-exported theme JSON. Auth-required. */
export async function POST(request: NextRequest) {
  if (demoBlock()) {
    return NextResponse.json({ error: "read-only" }, { status: 403 });
  }
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Route handlers are not covered by the server-action bodySizeLimit —
  // cap the parse explicitly.
  const len = Number(request.headers.get("content-length") || 0);
  if (len > 2 * 1024 * 1024) {
    return NextResponse.json({ error: "Theme file too large" }, { status: 413 });
  }
  const text = await request.text();
  const result = await importTheme(text);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
