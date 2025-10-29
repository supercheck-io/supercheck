'use client';

import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { getNextRunDate, formatNextRunDate } from '@/lib/cron-utils';

interface NextRunDisplayProps {
  cronExpression: string | null | undefined;
}

const NextRunDisplay: React.FC<NextRunDisplayProps> = ({ cronExpression }) => {
  const [nextRun, setNextRun] = useState<string>('No date');

  useEffect(() => {
    if (cronExpression && cronExpression.trim() !== '') {
      try {
        const nextDate = getNextRunDate(cronExpression);
        setNextRun(formatNextRunDate(nextDate));
      } catch (error) {
        console.error('Error calculating next run date:', error);
        setNextRun('No date');
      }
    } else {
      setNextRun('No date');
    }
  }, [cronExpression]);

  if (!cronExpression || cronExpression.trim() === '') {
    return null;
  }

  return (
    <div className="flex items-center text-sm text-muted-foreground mt-2">
      <Clock className="h-4 w-4 mr-2 text-blue-500" />
      <span>Next run: {nextRun}</span>
    </div>
  );
};

export default NextRunDisplay; 