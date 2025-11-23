/**
 * Revoke Super Admin Privileges
 * 
 * This script downgrades a super_admin to a regular user (project_viewer).
 * 
 * Usage: 
 *   node scripts/revoke-admin.js <email>
 */

const postgres = require('postgres');

async function main() {
  const email = process.argv[2];

  if (!email) {
    console.error('❌ Error: Email address required.');
    console.log('   Usage: node scripts/revoke-admin.js <email>');
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
      SELECT id, role FROM "user" WHERE email = ${email} LIMIT 1
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

    // Downgrade role to 'admin' (Organization Admin)
    await sql`
      UPDATE "user" SET role = 'admin' WHERE id = ${user.id}
    `;

    console.log(`✅ Successfully revoked super admin privileges from ${email}.`);
    console.log(`   User role is now 'admin' (Organization Admin).`);

  } catch (error) {
    console.error('❌ Error revoking super admin:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
