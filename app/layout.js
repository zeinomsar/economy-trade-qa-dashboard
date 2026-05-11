import "./globals.css";

export const metadata = {
  title: "Economy and Trade Services QA",
  description: "Minimal QA editing dashboard for Economy and Trade service records"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
