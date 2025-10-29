/**
 * Bootstrap First Super Admin Script
 *
 * Usage: npx tsx app/src/lib/bootstrap-super-admin.ts <email>
 * Example: npx tsx app/src/lib/bootstrap-super-admin.ts admin@example.com
 *
 * IMPORTANT: This should only be run ONCE during initial setup
 */

import { bootstrapFirstSuperAdmin } from "./rbac/super-admin";

async function main() {
  const email = process.argv[2];

  if (!email) {
    console.error("❌ Error: Email address required");
    console.log(
      "\nUsage: npx tsx app/src/lib/bootstrap-super-admin.ts <email>"
    );
    console.log(
      "Example: npx tsx app/src/lib/bootstrap-super-admin.ts admin@example.com"
    );
    process.exit(1);
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    console.error("❌ Error: Invalid email format");
    process.exit(1);
  }

  console.log(`🔐 Bootstrapping super admin for: ${email}`);
  console.log("⏳ Please wait...\n");

  try {
    const result = await bootstrapFirstSuperAdmin(email, "bootstrap-script");

    if (result.success) {
      console.log("✅ SUCCESS:", result.message);
      console.log("\n📝 Next steps:");
      console.log(
        "1. The user must sign up with this email first if they haven't already"
      );
      console.log("2. Once signed up, they will have super admin privileges");
      console.log(
        "3. They can then grant admin access to other users via the UI"
      );
      console.log("\n⚠️  SECURITY: Remove this script after initial setup");
    } else {
      console.error("❌ ERROR:", result.message);

      if (result.message.includes("already exist")) {
        console.log("\n💡 TIP: Super admin(s) already exist.");
        console.log("Use the admin UI to grant super admin to other users.");
      } else if (result.message.includes("not found")) {
        console.log(
          "\n💡 TIP: User must sign up first before becoming super admin."
        );
        console.log("1. Ask the user to sign up with email:", email);
        console.log("2. Run this script again after they've signed up");
      }

      process.exit(1);
    }
  } catch (error) {
    console.error("❌ Unexpected error:", error);
    process.exit(1);
  }
}

main();
