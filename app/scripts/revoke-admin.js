/**
 * Revoke Super Admin Privileges
 * 
 * This script removes super_admin privileges and downgrades to project_viewer.
 * 
 * Usage: 
 *   node scripts/revoke-admin.js <email>
 */

require('dotenv').config();
const postgres = require('postgres');

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();

  if (!email) {
    console.error('❌ Error: Email address required.');
    console.log('   Usage: node scripts/revoke-admin.js <email>');
    process.exit(1);
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    console.error('❌ Error: Invalid email format.');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set. Cannot revoke admin.');
    process.exit(1);
  }

  console.log(`🔓 Revoking super admin privileges for: ${email}`);

  const sql = postgres(process.env.DATABASE_URL, {
    ssl: process.env.DATABASE_SSL === 'true' ? 'require' : false,
    max: 1
  });

  try {
    // Check if user exists and is actually an admin
    const users = await sql`
      SELECT id, role FROM "user" WHERE LOWER(email) = ${email} LIMIT 1
    `;

    if (users.length === 0) {
      console.error(`❌ Error: User ${email} not found.`);
      process.exit(1);
    }

    const user = users[0];

    if (user.role !== 'super_admin') {
      console.log(`ℹ️  User ${email} is NOT a super admin (Role: ${user.role}).`);
      return;
    }

    // Downgrade the system-level role and invalidate active sessions together
    // so cached auth state cannot keep super_admin access after revocation.
    const revokedSessionCount = await sql.begin(async (tx) => {
      await tx`
        UPDATE "user" SET role = 'project_viewer' WHERE id = ${user.id}
      `;

      const revokedSessions = await tx`
        DELETE FROM "session" WHERE user_id = ${user.id} RETURNING id
      `;

      return revokedSessions.length;
    });

    console.log(`✅ Successfully revoked super admin privileges from ${email}.`);
    console.log(`   User system role is now 'project_viewer'.`);
    console.log(`   Invalidated ${revokedSessionCount} active session(s).`);

  } catch (error) {
    console.error('❌ Error revoking super admin:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
