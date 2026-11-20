import { NextResponse } from "next/server";
import { isAdmin, isOrgAdmin } from "@/lib/admin";

export async function GET() {
  try {
    // The sidebar needs both flags on every page load; one request answers both.
    // allSettled: one failed lookup must not hide the other link.
    const results = await Promise.allSettled([isAdmin(), isOrgAdmin()]);
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length === results.length) throw failed[0].reason;
    failed.forEach((r) => console.error("Admin check lookup failed:", r.reason));
    const [userIsAdmin, userIsOrgAdmin] = results.map((r) => r.status === "fulfilled" && r.value === true);

    return NextResponse.json({
      success: true,
      isAdmin: userIsAdmin,
      isOrgAdmin: userIsOrgAdmin,
    });
  } catch (error) {
    console.error("Admin check error:", error);
    return NextResponse.json(
      { success: false, isAdmin: false, isOrgAdmin: false },
      { status: 500 }
    );
  }
}
