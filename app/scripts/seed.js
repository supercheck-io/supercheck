#!/usr/bin/env node

/**
 * Database Seeder
 * Runs seed SQL files from the seeds directory
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

async function runSeeds() {
  console.log('🌱 Running database seeds...');
  
  // Check if DATABASE_URL is set
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
  }

  // Create postgres client
  const sql = postgres(process.env.DATABASE_URL, {
    max: 1, // Only one connection for seeding
  });

  try {
    // Get all seed files
    const seedsDir = path.join(__dirname, '../src/db/seeds');
    
    if (!fs.existsSync(seedsDir)) {
      console.log('📁 No seeds directory found, skipping seeds');
      return;
    }

    const seedFiles = fs.readdirSync(seedsDir)
      .filter(file => file.endsWith('.seed.sql'))
      .sort(); // Run in alphabetical order

    if (seedFiles.length === 0) {
      console.log('📁 No seed files found');
      return;
    }

    console.log(`📁 Found ${seedFiles.length} seed file(s):`, seedFiles);

    // Run each seed file
    for (const seedFile of seedFiles) {
      console.log(`\n🌱 Running seed: ${seedFile}`);
      
      const seedPath = path.join(seedsDir, seedFile);
      const seedSQL = fs.readFileSync(seedPath, 'utf8');
      
      // Split SQL using statement-breakpoint (same as migrations)
      const statements = seedSQL
        .split('--> statement-breakpoint')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

      for (const statement of statements) {
        await sql.unsafe(statement);
      }

      console.log(`✅ Completed seed: ${seedFile}`);
    }

    console.log('\n🎉 All seeds completed successfully!');
  } catch (error) {
    console.error('❌ Error running seeds:', error.message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

// Run seeds if called directly
if (require.main === module) {
  runSeeds();
}

module.exports = { runSeeds };
