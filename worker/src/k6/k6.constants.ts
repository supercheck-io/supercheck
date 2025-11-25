// The queue names are now dynamic based on the region and execution type
export const K6_QUEUE = process.env.QUEUE_NAME || 'k6-global';

export const REGIONS = ['us-east', 'eu-central', 'asia-pacific', 'global'] as const;
export type Region = typeof REGIONS[number];

export const K6_QUEUES = {
  US_EAST: 'k6-us-east',
  EU_CENTRAL: 'k6-eu-central',
  ASIA_PACIFIC: 'k6-asia-pacific',
  GLOBAL: 'k6-global',
};
