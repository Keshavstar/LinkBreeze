import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getVisitorHash, stripReferrer } from "@/lib/visitor";
import { rateLimit } from "@/lib/rate-limit";
import { isBot } from "@/lib/bot-detect";
import { getSession } from "@/lib/auth";
import { getLinkByRef, getPageById, recordClick } from "@/server/queries";
import { maybeRunScheduledBackup } from "@/server/backup-scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * JS-free click tracking redirect.
 *
 * The ref is the link's numeric id (behavior unchanged) or its custom
 * redirect slug (#96) — case-insensitive, resolved via getLinkByRef.
 * Records a click for the given link, then 302-redirects to the link's URL.
 * Works without client-side JS (crawlers, in-app browsers that block
 * sendBeacon, JS-disabled browsers). The public page uses /go/:ref as the
 * href for http(s) links so clicks are always counted.
 *
 * A DEACTIVATED link that has a custom slug redirects to its public page
 * instead of a bare 404: the slug is a shareable printed/embedded URL and
 * should degrade to the page, never die silently. Links without a slug
 * keep the plain 404.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawRef } = await params;
  const link = await getLinkByRef(rawRef);

  if (!link) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }

  if (!link.isActive) {
    if (link.redirectSlug) {
      const page = await getPageById(link.pageId);
      if (page) {
        return NextResponse.redirect(new URL(`/${page.slug}`, request.url), {
          status: 302,
          headers: { "Cache-Control": "no-store" },
        });
      }
    }
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }

  const linkId = link.id;

  // Defense-in-depth: only redirect to http(s) URLs. The create/update
  // validators already block javascript:/data: schemes, but a stale or
  // tampered DB row could bypass that. Never 302 to a non-http protocol.
  try {
    const parsed = new URL(link.url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return NextResponse.json({ error: "Invalid link URL" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid link URL" }, { status: 400 });
  }

  // Record the click — same visitor hash logic as /api/track.
  // Rate-limited per IP to prevent click-inflation attacks (a bot
  // hammering /go/:id to inflate a competitor's or victim's counts).
  // Matches the throttle on /api/track: 60 events/min/IP.
  try {
    const h = await headers();
    const ip =
      (h.get("x-forwarded-for")?.split(",")[0] || "").trim() ||
      (h.get("x-real-ip") || "").toString() ||
      "0.0.0.0";

    const rl = rateLimit(`go:${ip}`, 60, 60_000);
    if (rl.ok) {
      const userAgent = (h.get("user-agent") || "").toString();

      // Skip analytics outside production — dev/preview traffic is the owner.
      // Issue #41: Don't record clicks for known bots/crawlers.
      // Issue #40: Don't record clicks for the owner (authenticated admin).
      // Cookie-first: avoids DB query on every anonymous click.
      const isCrawler = isBot(userAgent);
      const hasSessionCookie = !!h.get("cookie")?.includes("lb_session");
      const isOwner = hasSessionCookie ? await getSession() : null;
      if (process.env.NODE_ENV === "production" && !isCrawler && !isOwner) {
        const visitorHash = getVisitorHash(ip, userAgent);
        const referrer = stripReferrer(
          (h.get("referer") || h.get("referrer") || "").toString(),
        );
        await recordClick(linkId, visitorHash, referrer);
        // #83: opportunistic scheduled-backup trigger (throttled inside the
        // scheduler; must never delay the redirect — fire-and-forget).
        maybeRunScheduledBackup();
      }
    }
    // If rate-limited, we still redirect the user to their destination —
    // we just don't count the click. Real users never hit the limit;
    // only bots/loops do.
  } catch (err) {
    // Don't block the redirect if analytics fails — the user should still
    // reach their destination.
    console.error("[/go/:id] failed to record click", err);
  }

  return NextResponse.redirect(link.url, {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}
