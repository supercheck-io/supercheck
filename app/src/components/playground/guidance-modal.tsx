'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { X } from 'lucide-react';

interface GuidanceModalProps {
  isVisible: boolean;
  guidance: string;
  onClose: () => void;
}

export function GuidanceModal({
  isVisible,
  guidance,
  onClose,
}: GuidanceModalProps) {

  const formatGuidanceText = (text: string) => {
    // Convert markdown-style formatting to JSX
    return text.split('\n').map((line, index) => {
      // Handle headers
      if (line.startsWith('**') && line.endsWith('**')) {
        const content = line.slice(2, -2);
        return (
          <h4 key={index} className="font-semibold text-gray-900 dark:text-gray-100 mt-4 mb-2 first:mt-0">
            {content}
          </h4>
        );
      }
      
      // Handle bullet points
      if (line.startsWith('• ')) {
        return (
          <li key={index} className="ml-4 text-gray-700 dark:text-gray-300 mb-1">
            {line.slice(2)}
          </li>
        );
      }
      
      // Handle emoji lines (like 🌐, 🔐, etc.)
      if (line.match(/^[🌐🔐🏗️📊🔍📄⚡📋]/)) {
        return (
          <div key={index} className="font-medium text-gray-800 dark:text-gray-200 mt-3 mb-2">
            {line}
          </div>
        );
      }
      
      // Handle bold text inline
      if (line.includes('**')) {
        const parts = line.split('**');
        return (
          <p key={index} className="text-gray-700 dark:text-gray-300 mb-2">
            {parts.map((part, partIndex) =>
              partIndex % 2 === 1 ?
                <strong key={partIndex} className="font-semibold text-gray-900 dark:text-gray-100">{part}</strong> :
                part
            )}
          </p>
        );
      }
      
      // Handle empty lines
      if (line.trim() === '') {
        return <div key={index} className="mb-2" />;
      }
      
      // Regular text
      return (
        <p key={index} className="text-gray-700 dark:text-gray-300 mb-2">
          {line}
        </p>
      );
    });
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-lg shadow-xl bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-medium text-gray-900 dark:text-gray-100">
              Manual Review Required
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            This test failure requires manual investigation.
          </p>

          {/* Clean Professional Guidance */}
          <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
            {formatGuidanceText(guidance)}
          </div>
        </CardContent>

        {/* Minimal Footer */}
        <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-3 bg-gray-50 dark:bg-gray-800/50">
          <div className="flex justify-end">
            <Button
              onClick={onClose}
              className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white px-4 text-sm"
            >
              Continue
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}