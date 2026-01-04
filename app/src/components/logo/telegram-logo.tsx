import { cn } from "@/lib/utils";

interface TelegramLogoProps {
    size?: number;
    className?: string;
    width?: number;
    height?: number;
}

export function TelegramLogo({
    size = 24,
    className,
    width,
    height,
}: TelegramLogoProps) {
    const w = width || size;
    const h = height || size;

    return (
        <svg
            width={w}
            height={h}
            viewBox="0 0 100 100"
            version="1.1"
            xmlSpace="preserve"
            xmlns="http://www.w3.org/2000/svg"
            xmlnsXlink="http://www.w3.org/1999/xlink"
            className={cn("shrink-0", className)}
        >
            <g>
                <path
                    d="M88.723,12.142C76.419,17.238,23.661,39.091,9.084,45.047c-9.776,3.815-4.053,7.392-4.053,7.392    s8.345,2.861,15.499,5.007c7.153,2.146,10.968-0.238,10.968-0.238l33.62-22.652c11.922-8.107,9.061-1.431,6.199,1.431    c-6.199,6.2-16.452,15.975-25.036,23.844c-3.815,3.338-1.908,6.199-0.238,7.63c6.199,5.246,23.129,15.976,24.082,16.691    c5.037,3.566,14.945,8.699,16.452-2.146c0,0,5.961-37.435,5.961-37.435c1.908-12.637,3.815-24.321,4.053-27.659    C97.307,8.804,88.723,12.142,88.723,12.142z"
                    fill="#1B92D1"
                />
            </g>
        </svg>
    );
}
