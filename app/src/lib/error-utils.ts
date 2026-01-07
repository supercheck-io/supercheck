/**
 * Utility function to create user-friendly error messages for notification providers
 * Hides sensitive system errors and provides generic, user-friendly messages
 */
export const getUserFriendlyError = (error: unknown, providerType: string): string => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  // Hide sensitive system errors and provide generic messages
  if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('ECONNREFUSED')) {
    return `Unable to connect to ${providerType} service. Please check your configuration.`;
  }
  
  if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
    return `Connection timeout. Please try again or check your network connection.`;
  }
  
  if (errorMessage.includes('SSL') || errorMessage.includes('TLS')) {
    return `Security connection failed. Please check your SSL/TLS settings.`;
  }
  
  if (errorMessage.includes('401') || errorMessage.includes('403')) {
    return `Authentication failed. Please verify your credentials.`;
  }
  
  if (errorMessage.includes('Invalid email format')) {
    return `Please check your email addresses format.`;
  }
  
  if (errorMessage.includes('SMTP configuration missing')) {
    return `Email service is not properly configured. Please contact your administrator.`;
  }
  
  if (errorMessage.includes('webhook') && errorMessage.includes('required')) {
    return `${providerType} webhook URL is required. Please check your configuration.`;
  }
  
  if (errorMessage.includes('400') || errorMessage.includes('Bad Request')) {
    return `Invalid configuration for ${providerType}. Please check your settings.`;
  }
  
  if (errorMessage.includes('404') || errorMessage.includes('Not Found')) {
    return `${providerType} endpoint not found. Please verify your configuration.`;
  }
  
  if (errorMessage.includes('500') || errorMessage.includes('Internal Server Error')) {
    return `${providerType} service is currently unavailable. Please try again later.`;
  }
  
  // For other specific errors, provide generic message
  return `${providerType} connection test failed. Please check your configuration and try again.`;
};

/**
 * Validation patterns for different notification providers
 */
export const VALIDATION_PATTERNS = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  slackWebhook: /^https:\/\/hooks\.slack\.com\/services\//,
  slackChannel: /^#[a-z0-9-_]+$/,
  telegramBotToken: /^\d+:[A-Za-z0-9_-]+$/,
  telegramChatId: /^-?\d+$/,
  discordWebhook: /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//,
  teamsWebhook: /^https:\/\/[a-zA-Z0-9-]+\.webhook\.office\.com\//,
  httpUrl: /^https?:\/\/.+/,
} as const;

/**
 * Maximum character limits for form fields
 */
export const CHARACTER_LIMITS = Object.freeze({
  emails: 500,
  bodyTemplate: 2000,
  name: 255,
  url: 2048,
} as const);