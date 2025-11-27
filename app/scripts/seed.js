#!/usr/bin/env node

/**
 * Database Seeder
 * Runs seed SQL files from the seeds directory
 * 
 * Supports both:
 * - SQL files with `--> statement-breakpoint` markers
 * - Plain SQL files (executed as single statement)
 */

const fs = require('fs');
const path = require('path');
// Load .env.local for local development, but don't override existing env vars (Docker)
try {
  require('dotenv').config({ path: '.env.local', override: false });
} catch (e) {
  // dotenv is optional for Docker environments
}

// Import postgres
const postgres = require('postgres');

// Environment variables with defaults (same as db-migrate.js)
const DB_HOST = process.env.DB_HOST || "localhost";
const DB_PORT = process.env.DB_PORT || "5432";
const DB_USER = process.env.DB_USER || "postgres";
const DB_PASSWORD = process.env.DB_PASSWORD || "postgres";
const DB_NAME = process.env.DB_NAME || "supercheck";
const DATABASE_URL =
  process.env.DATABASE_URL ||
  `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;

// Helper function to retry database operations
async function withRetry(fn, maxRetries = 3, delay = 2000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      console.log(`⚠️  Attempt ${i + 1} failed, retrying in ${delay}ms... (${err.message})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 1.5; // Exponential backoff
    }
  }
}

async function runSeeds() {
  console.log('🌱 Running database seeds...');

  // Create postgres client with connection timeout and retry
  const sql = postgres(DATABASE_URL, {
    max: 1, // Only one connection for seeding
    connect_timeout: 30, // 30 second timeout
    idle_timeout: 20, // 20 second idle timeout
    max_lifetime: 60, // 60 second max lifetime
  });

  try {
    // Test database connection with retry
    console.log('🔍 Testing database connection...');
    await withRetry(async () => {
      await sql`SELECT 1`;
      console.log('✅ Database connection successful');
    });
    // Get all seed files
    const seedsDir = path.join(__dirname, '../src/db/seeds');
    
    if (!fs.existsSync(seedsDir)) {
      console.log('📁 No seeds directory found, skipping seeds');
      await sql.end();
      return;
    }

    const seedFiles = fs.readdirSync(seedsDir)
      .filter(file => file.endsWith('.seed.sql'))
      .sort(); // Run in alphabetical order

    if (seedFiles.length === 0) {
      console.log('📁 No seed files found');
      await sql.end();
      return;
    }

    console.log(`📁 Found ${seedFiles.length} seed file(s):`, seedFiles);

    // Run each seed file
    for (const seedFile of seedFiles) {
      console.log(`\n🌱 Running seed: ${seedFile}`);
      
      const seedPath = path.join(seedsDir, seedFile);
      const seedSQL = fs.readFileSync(seedPath, 'utf8');
      
      // Check if file uses statement-breakpoint markers
      let statements;
      if (seedSQL.includes('--> statement-breakpoint')) {
        // Split by statement-breakpoint marker
        statements = seedSQL
          .split('--> statement-breakpoint')
          .map(stmt => stmt.trim())
          .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
      } else {
        // Run as single statement (handles INSERT with multiple VALUES)
        statements = [seedSQL.trim()];
      }

      for (const statement of statements) {
        if (!statement || statement.startsWith('--')) continue;
        
        try {
          await sql.unsafe(statement);
        } catch (err) {
          // Handle expected errors gracefully
          const errorMsg = err.message.toLowerCase();
          if (errorMsg.includes('duplicate key') || 
              errorMsg.includes('already exists') ||
              errorMsg.includes('violates unique constraint')) {
            console.log(`⚠️  Skipping (already seeded): ${err.message.substring(0, 100)}`);
          } else {
            throw err;
          }
        }
      }

      console.log(`✅ Completed seed: ${seedFile}`);
    }

    console.log('\n🎉 All seeds completed successfully!');

    // Verify plan_limits were seeded correctly
    console.log('\n🔍 Verifying plan_limits seeding...');
    const planLimitsCount = await sql`SELECT COUNT(*) as count FROM plan_limits`;
    const count = parseInt(planLimitsCount[0]?.count || '0', 10);
    
    if (count === 0) {
      console.error('❌ CRITICAL: plan_limits table is empty after seeding!');
      console.error('   This will cause subscription errors. Please check the seed SQL.');
      throw new Error('plan_limits table is empty after seeding');
    }
    
    // Verify specific plans exist
    const plans = await sql`SELECT plan FROM plan_limits ORDER BY plan`;
    const planNames = plans.map(p => p.plan);
    console.log(`✅ Verified ${count} plan(s) in database: ${planNames.join(', ')}`);
    
    // Check for required plans
    const requiredPlans = ['plus', 'pro', 'unlimited'];
    const missingPlans = requiredPlans.filter(p => !planNames.includes(p));
    if (missingPlans.length > 0) {
      console.warn(`⚠️  Missing plans: ${missingPlans.join(', ')}`);
    }
    
  } catch (error) {
    console.error('❌ Error running seeds:', error.message);
    throw error; // Re-throw to signal failure
  } finally {
    await sql.end();
  }
}

// Run seeds if called directly
if (require.main === module) {
  runSeeds()
    .then(() => {
      console.log('✅ Seeding completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Seeding failed:', error.message);
      process.exit(1);
    });
}

module.exports = { runSeeds };
