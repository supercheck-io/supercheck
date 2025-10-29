declare namespace NodeJS {
  interface ProcessEnv {
    // Database
    DATABASE_URL: string;
    DB_HOST: string;
    DB_PORT: string;
    DB_USER: string;
    DB_PASSWORD: string;
    DB_NAME: string;

    // AWS S3 / MinIO Configuration
    AWS_REGION: string;
    AWS_ACCESS_KEY_ID: string;
    AWS_SECRET_ACCESS_KEY: string;
    S3_ENDPOINT: string;
    S3_JOB_BUCKET_NAME: string;
    S3_FORCE_PATH_STYLE: string;
    S3_OPERATION_TIMEOUT: string;
    S3_MAX_RETRIES: string;

    // App Config
    RUNNING_CAPACITY: string;
    QUEUED_CAPACITY: string;
    TEST_EXECUTION_TIMEOUT_MS: string;

    // Playwright Config
    PLAYWRIGHT_RETRIES: string;
    PLAYWRIGHT_WORKERS: string;

    // Redis Configuration
    REDIS_HOST: string;
    REDIS_PORT: string;
    REDIS_PASSWORD: string;
    REDIS_URL: string;


    // Playground Cleanup Configuration
    PLAYGROUND_CLEANUP_ENABLED: string;
    PLAYGROUND_CLEANUP_CRON: string;
    PLAYGROUND_CLEANUP_MAX_AGE_HOURS: string;
  }
} 