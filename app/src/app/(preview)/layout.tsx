/** Signed-in status page preview: the public page without the app shell, shown in the in-app preview overlay. */
export default function PreviewLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="font-sans antialiased">{children}</div>;
}
