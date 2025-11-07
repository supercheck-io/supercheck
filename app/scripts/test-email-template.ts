/**
 * Test script to verify email template rendering
 * Run with: npx tsx scripts/test-email-template.ts
 */

import { renderMonitorAlertEmail } from '../src/lib/email-renderer';

async function testTemplate() {
  console.log('Testing email template rendering...\n');

  const result = await renderMonitorAlertEmail({
    title: 'Job Completed - Test Job',
    message: 'Job "Test Job" has completed successfully.',
    fields: [
      { title: 'Job Name', value: 'Test Job' },
      { title: 'Status', value: 'Success' },
      { title: 'Duration', value: '5 seconds' },
    ],
    footer: 'Supercheck Job Monitoring',
    type: 'success',
    color: '#10b981',
  });

  console.log('Subject:', result.subject);
  console.log('\nHTML Preview (first 500 chars):');
  console.log(result.html.substring(0, 500));
  console.log('\n...\n');

  // Check if header color is present
  if (result.html.includes('#10b981') || result.html.includes('rgb(16, 163, 129)')) {
    console.log('✅ GREEN header color found in HTML!');
  } else if (result.html.includes('#4a5568') || result.html.includes('#1f2937')) {
    console.log('❌ GRAY header detected - color prop not working');
  } else {
    console.log('⚠️  Could not detect header color');
  }

  // Save to file for inspection
  const fs = await import('fs');
  fs.writeFileSync('/tmp/test-email.html', result.html);
  console.log('\n📄 Full HTML saved to: /tmp/test-email.html');
}

testTemplate().catch(console.error);
