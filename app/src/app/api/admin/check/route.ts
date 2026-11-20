import { NextResponse } from "next/server";
import { isAdmin, isOrgAdmin } from "@/lib/admin";

export async function GET() {
  try {
    // The sidebar needs both flags on every page load; one request answers both.
    const [userIsAdmin, userIsOrgAdmin] = await Promise.all([isAdmin(), isOrgAdmin()]);

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
