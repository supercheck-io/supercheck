import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Social preview card (1200x630), rendered once at build time into out/og.png.
export const dynamic = "force-static";

const font = (file: string) => readFile(join(process.cwd(), "node_modules/geist/dist/fonts/geist-sans", file));

export async function GET() {
  const [regular, semibold, logo] = await Promise.all([
    font("Geist-Regular.ttf"),
    font("Geist-SemiBold.ttf"),
    readFile(join(process.cwd(), "public/supercheck-logo.png")),
  ]);
  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", padding: 80, background: "#0a0a0a", color: "#fafafa", fontFamily: "Geist" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain img only */}
          <img src={`data:image/png;base64,${logo.toString("base64")}`} width={64} height={64} alt="" />
          <span style={{ fontSize: 44, fontWeight: 600 }}>Supercheck</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ display: "flex", flexWrap: "wrap", fontSize: 76, fontWeight: 600, lineHeight: 1.05, letterSpacing: -2 }}>
            <span>Open-source testing, monitoring, and AI SRE –&nbsp;</span>
            <span style={{ color: "#60a5fa" }}>as code</span>
          </div>
          <span style={{ fontSize: 30, color: "#a1a1aa" }}>Playwright and k6 tests, uptime monitors, incidents and status pages</span>
        </div>
        <span style={{ fontSize: 26, color: "#a1a1aa" }}>supercheck.io</span>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Geist", data: regular, weight: 400 },
        { name: "Geist", data: semibold, weight: 600 },
      ],
    },
  );
}
