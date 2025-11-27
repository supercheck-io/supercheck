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

async function runSeeds() {
  console.log('🌱 Running database seeds...');

  // Create postgres client
  const sql = postgres(DATABASE_URL, {
    max: 1, // Only one connection for seeding
  });

  try {
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
  } catch (error) {
    console.error('❌ Error running seeds:', error.message);
    throw error; // Re-throw to signal failure
  } finally {
    await sql.end();
  }
}

// Run seeds if called directly
if (require.main === module) {
  runSeeds();
}

module.exports = { runSeeds };
