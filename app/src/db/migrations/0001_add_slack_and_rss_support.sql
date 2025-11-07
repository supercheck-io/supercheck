-- Migration: Add Slack and RSS feed support to status pages
-- Date: 2025-11-07

-- Add allowSlackSubscribers column to status_pages table
ALTER TABLE "status_pages" ADD COLUMN "allow_slack_subscribers" boolean DEFAULT true;

-- Add allowRssFeed column to status_pages table
ALTER TABLE "status_pages" ADD COLUMN "allow_rss_feed" boolean DEFAULT true;
