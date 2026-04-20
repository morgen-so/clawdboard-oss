import Link from "next/link";

export default function RootNotFound() {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#09090b",
          color: "#fafafa",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div style={{ textAlign: "center", padding: "1rem" }}>
          <p
            style={{
              fontSize: 56,
              fontWeight: 700,
              margin: "0 0 0.5rem",
              opacity: 0.1,
            }}
          >
            404
          </p>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 0.5rem" }}>
            Page not found
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "#a1a1aa",
              margin: "0 0 1.5rem",
              maxWidth: 360,
            }}
          >
            The page you’re looking for doesn’t exist or has been
            moved.
          </p>
          <Link
            href="/en"
            style={{
              backgroundColor: "#F9A615",
              color: "#09090b",
              border: "none",
              borderRadius: 8,
              padding: "0.5rem 1rem",
              fontSize: 14,
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            Back to Leaderboard
          </Link>
        </div>
      </body>
    </html>
  );
}
