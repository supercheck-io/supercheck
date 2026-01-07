-- Migration: Convert P1/P2/P3/P4 priorities to low/medium/high
-- This is for consistency with the tests table which uses low/medium/high

-- Update existing requirements
UPDATE requirements SET priority = 'high' WHERE priority IN ('P1', 'P2');
UPDATE requirements SET priority = 'medium' WHERE priority = 'P3';
UPDATE requirements SET priority = 'low' WHERE priority = 'P4';
