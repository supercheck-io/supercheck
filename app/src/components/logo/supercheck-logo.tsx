import * as React from "react";

/**
 * SupercheckLogo - The official Supercheck brand logo
 * 
 * Design: Green rounded rectangle with a white checkmark inside
 * This is the single source of truth for the Supercheck logo across the app.
 */
export function SupercheckLogo(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 58 58"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      {...props}
    >
      {/* White background layer - makes the checkmark appear white */}
      <rect
        x="1.8"
        y="1.5"
        width="54.8"
        height="54.9"
        rx="15"
        fill="white"
      />
      {/* Green outer shape with checkmark cutout */}
      <path
        d="M56.6095 17.7393C44.1095 26.8793 33.3295 38.8793 23.6895 48.9493C22.9795 49.6593 22.0495 50.1593 21.0495 50.1593C19.8395 50.1593 18.9095 49.4493 18.0495 48.1593C15.5495 44.4493 11.7695 35.4493 10.0495 31.5193C8.68954 28.3093 9.40954 25.6593 12.6195 24.3093C15.8295 23.0193 19.3995 22.8093 20.2595 26.4493C20.2595 26.4493 21.8995 32.8093 22.3995 34.6593C32.3295 25.4493 44.5395 15.6693 54.8895 9.66929C52.3195 4.80929 47.2495 1.5293 41.4695 1.5293H16.9795C8.54954 1.5293 1.76953 8.30929 1.76953 16.6693V41.2293C1.76953 49.5793 8.54954 56.3693 16.9795 56.3693H41.4695C49.8195 56.3693 56.6095 49.5893 56.6095 41.2293V17.7393V17.7393Z"
        fill="#16a34a"
      />
    </svg>
  );
}

// Export alias for backward compatibility
export { SupercheckLogo as CheckIcon };