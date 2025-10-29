/**
 * Format a date to a human-readable distance from now
 * @param date ISO date string or Date object
 * @returns Formatted relative time (e.g., "5 minutes ago", "2 hours ago")
 */
export function formatDistanceToNow(date: string | Date): string {
  const now = new Date();
  const dateToCompare = typeof date === 'string' ? new Date(date) : date;
  
  // Calculate time difference in seconds
  const diffInSeconds = Math.floor((now.getTime() - dateToCompare.getTime()) / 1000);
  
  if (isNaN(diffInSeconds)) {
    return 'Invalid date';
  }
  
  // Time units in seconds
  const minute = 60;
  const hour = minute * 60;
  const day = hour * 24;
  const week = day * 7;
  const month = day * 30;
  const year = day * 365;
  
  // Format based on time difference
  if (diffInSeconds < 30) {
    return 'just now';
  } else if (diffInSeconds < minute) {
    return `${diffInSeconds} seconds ago`;
  } else if (diffInSeconds < hour) {
    const minutes = Math.floor(diffInSeconds / minute);
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  } else if (diffInSeconds < day) {
    const hours = Math.floor(diffInSeconds / hour);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  } else if (diffInSeconds < week) {
    const days = Math.floor(diffInSeconds / day);
    return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  } else if (diffInSeconds < month) {
    const weeks = Math.floor(diffInSeconds / week);
    return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
  } else if (diffInSeconds < year) {
    const months = Math.floor(diffInSeconds / month);
    return `${months} ${months === 1 ? 'month' : 'months'} ago`;
  } else {
    const years = Math.floor(diffInSeconds / year);
    return `${years} ${years === 1 ? 'year' : 'years'} ago`;
  }
}

/**
 * Format minutes into a human-readable duration format
 * @param minutes Number of minutes
 * @returns Formatted duration (e.g., "1m", "1h", "1h 30m", "2d 5h 30m")
 */
export function formatDurationMinutes(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  } else if (minutes < 1440) { // Less than 24 hours
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    
    if (remainingMinutes === 0) {
      return `${hours}h`;
    } else {
      return `${hours}h ${remainingMinutes}m`;
    }
  } else { // 24 hours or more
    const days = Math.floor(minutes / 1440);
    const remainingMinutes = minutes % 1440;
    const hours = Math.floor(remainingMinutes / 60);
    const finalMinutes = remainingMinutes % 60;
    
    let result = `${days}d`;
    
    if (hours > 0) {
      result += ` ${hours}h`;
    }
    
    if (finalMinutes > 0) {
      result += ` ${finalMinutes}m`;
    }
    
    return result;
  }
} 