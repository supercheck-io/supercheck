import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";

export async function GET() {
  try {
    const userIsAdmin = await isAdmin();

    return NextResponse.json({
      success: true,
      isAdmin: userIsAdmin,
    });
  } catch (error) {
    console.error("Admin check error:", error);
    return NextResponse.json(
      { success: false, isAdmin: false },
      { status: 500 }
    );
  }
}
