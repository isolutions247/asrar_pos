import { type ReactNode } from "react";
import { useAuth } from "@workspace/replit-auth-web";
import logoUrl from "@assets/WhatsApp_Image_2026-04-23_at_11.05.44_PM_1777135297272.jpeg";

interface Props {
  children: ReactNode;
}

export function AuthGate({ children }: Props) {
  const { user, isLoading, isAuthenticated, login } = useAuth();

  if (isLoading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f172a",
          color: "#e2e8f0",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div>Loading…</div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #312e81 100%)",
          color: "#e2e8f0",
          fontFamily: "system-ui, sans-serif",
          padding: "1rem",
        }}
      >
        <div
          style={{
            background: "rgba(15, 23, 42, 0.7)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            border: "1px solid rgba(148, 163, 184, 0.2)",
            borderRadius: "16px",
            padding: "2.5rem",
            maxWidth: "420px",
            width: "100%",
            textAlign: "center",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
          }}
        >
          <img
            src={logoUrl}
            alt="Asrar Altahi Almomaiz Restaurant"
            style={{
              width: "180px",
              height: "180px",
              objectFit: "contain",
              margin: "0 auto 1rem",
              display: "block",
              filter: "drop-shadow(0 8px 20px rgba(0, 0, 0, 0.4))",
            }}
          />
          <div
            style={{
              fontSize: "3.75rem",
              fontWeight: 900,
              lineHeight: 1,
              letterSpacing: "0.02em",
              background:
                "linear-gradient(90deg, #fbbf24 0%, #f59e0b 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              textShadow: "0 4px 24px rgba(251, 191, 36, 0.35)",
              marginBottom: "0.25rem",
            }}
          >
            Asrar
          </div>
          <div
            style={{
              fontSize: "1.05rem",
              fontWeight: 600,
              color: "#e2e8f0",
              marginBottom: "0.5rem",
              lineHeight: 1.2,
            }}
          >
            Altahi Almomaiz Restaurant
          </div>
          <div
            style={{
              fontSize: "0.85rem",
              color: "#94a3b8",
              marginBottom: "2rem",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            Point of Sale
          </div>
          <p
            style={{
              fontSize: "0.95rem",
              color: "#cbd5e1",
              marginBottom: "1.75rem",
              lineHeight: 1.6,
            }}
          >
            Please sign in to access the POS system.
          </p>
          <button
            type="button"
            onClick={login}
            style={{
              width: "100%",
              padding: "0.85rem 1.5rem",
              background: "linear-gradient(90deg, #f59e0b 0%, #d97706 100%)",
              color: "white",
              border: "none",
              borderRadius: "10px",
              fontSize: "1rem",
              fontWeight: 600,
              cursor: "pointer",
              transition: "transform 0.15s ease, box-shadow 0.15s ease",
              boxShadow: "0 4px 14px rgba(245, 158, 11, 0.4)",
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = "scale(0.98)";
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = "scale(1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "scale(1)";
            }}
          >
            Log in
          </button>
          <div
            style={{
              fontSize: "0.75rem",
              color: "#64748b",
              marginTop: "1.5rem",
            }}
          >
            Saudi Arabia · SAR · 15% VAT
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
