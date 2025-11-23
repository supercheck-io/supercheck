/**
 * Bootstrap Super Admin
 * 
 * This script promotes a user to super_admin.
 * It enforces a strict limit of ONE super admin in the system.
 * 
 * Usage: 
 *   node scripts/bootstrap-admin.js [email]
 *   OR set SUPER_ADMIN_EMAIL env var
 */

const postgres = require('postgres');

async function main() {
  // Prioritize CLI arg, fallback to env var
  const adminEmail = process.argv[2] || process.env.SUPER_ADMIN_EMAIL;

  if (!adminEmail) {
    console.log('ℹ️  No email provided (via CLI or SUPER_ADMIN_EMAIL). Skipping admin bootstrap.');
    return;
  }

  // Strict validation: Only allow one email
  if (adminEmail.includes(',')) {
    console.error('❌ Error: Email must be a single address, not a list.');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set. Cannot bootstrap admin.');
    process.exit(1);
  }

  console.log(`🔐 Bootstrapping super admin for: ${adminEmail}`);

  const sql = postgres(process.env.DATABASE_URL, {
    ssl: process.env.DATABASE_SSL === 'true' ? 'require' : false,
    max: 1
  });

  try {
    // 1. Check for ANY existing super admin
    const existingAdmins = await sql`
      SELECT email FROM "user" WHERE role = 'super_admin' LIMIT 1
    `;

    if (existingAdmins.length > 0) {
      const existingEmail = existingAdmins[0].email;
      
      if (existingEmail === adminEmail) {
        console.log(`✅ User ${adminEmail} is already the super admin.`);
        return;
      } else {
        console.error(`❌ Error: A super admin already exists (${existingEmail}).`);
        console.error('   System allows only ONE super admin.');
        console.error('   You must manually revoke the existing admin first.');
        process.exit(1);
      }
    }

    // 2. Check if target user exists
    const users = await sql`
      SELECT id FROM "user" WHERE email = ${adminEmail} LIMIT 1
    `;

    if (users.length === 0) {
      console.log(`⚠️  User ${adminEmail} not found. They must sign up first.`);
      return;
    }

    const user = users[0];

    // 3. Promote user
    await sql`
      UPDATE "user" SET role = 'super_admin' WHERE id = ${user.id}
    `;

    console.log(`✅ Successfully promoted ${adminEmail} to super_admin.`);

  } catch (error) {
    console.error('❌ Error bootstrapping super admin:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
