import { useState, useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useNavigate, redirect } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Check if user is already logged in
  const session = await authenticate.admin(request);
  // Redirect to home if already logged in
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const email = formData.get("email");
  const password = formData.get("password");
  const actionType = formData.get("actionType");

  // Handle login
  if (actionType === "login") {
    try {
      const response = await fetch("https://dtrack-backend-0zzv.onrender.com/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Return the token and user data to the frontend
        return {
          success: true,
          token: data.token,
          user: data.user,
        };
      } else {
        return {
          success: false,
          error: data.error || "Login failed",
        };
      }
    } catch (error) {
      return {
        success: false,
        error: "Failed to connect to authentication server",
      };
    }
  }

  return { success: false, error: "Invalid action" };
};

export default function LoginPage() {
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Check if login was successful
  useEffect(() => {
    if (fetcher.data) {
      const data = fetcher.data as any;
      if (data.success && data.token) {
        // Store token in session/localStorage
        localStorage.setItem("auth_token", data.token);
        localStorage.setItem("user", JSON.stringify(data.user));
        
        // Show success toast
        shopify.toast.show("Login successful! Redirecting...");
        
        // Redirect to the orders page
        setTimeout(() => {
          navigate("/app");
        }, 500);
      } else if (data.error) {
        setError(data.error);
        setIsLoading(false);
      }
    }
  }, [fetcher.data, navigate, shopify]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    
    const formData = new FormData();
    formData.append("actionType", "login");
    formData.append("email", email);
    formData.append("password", password);
    
    fetcher.submit(formData, { method: "POST" });
  };

  // Check if already logged in
  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (token) {
      navigate("/app");
    }
  }, [navigate]);

  return (
    <s-page heading="Login">
      <s-section>
        <div style={{ 
          maxWidth: "400px", 
          margin: "0 auto",
          padding: "40px 20px"
        }}>
          <div style={{ textAlign: "center", marginBottom: "32px" }}>
            <div style={{ fontSize: "48px", marginBottom: "12px" }}>🔐</div>
            <h2 style={{ margin: "0 0 8px 0", color: "#202223" }}>
              Welcome Back
            </h2>
            <p style={{ margin: "0", color: "#6d7175" }}>
              Login to access your orders dashboard
            </p>
          </div>

          {error && (
            <div style={{ 
              padding: "12px", 
              backgroundColor: "#fde7e7", 
              borderRadius: "4px",
              marginBottom: "16px",
              color: "#bf0711"
            }}>
              <strong>Error:</strong> {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: "16px" }}>
              <label 
                htmlFor="email"
                style={{
                  display: "block",
                  marginBottom: "4px",
                  fontWeight: "500",
                  fontSize: "14px"
                }}
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid #d1d2d4",
                  borderRadius: "4px",
                  fontSize: "14px",
                  boxSizing: "border-box"
                }}
                placeholder="Enter your email"
              />
            </div>

            <div style={{ marginBottom: "24px" }}>
              <label 
                htmlFor="password"
                style={{
                  display: "block",
                  marginBottom: "4px",
                  fontWeight: "500",
                  fontSize: "14px"
                }}
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid #d1d2d4",
                  borderRadius: "4px",
                  fontSize: "14px",
                  boxSizing: "border-box"
                }}
                placeholder="Enter your password"
                minLength={6}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || fetcher.state === "submitting"}
              style={{
                width: "100%",
                padding: "12px",
                backgroundColor: "#006e52",
                color: "white",
                border: "none",
                borderRadius: "4px",
                fontSize: "16px",
                fontWeight: "600",
                cursor: "pointer",
                transition: "background-color 0.2s"
              }}
              onMouseEnter={(e) => {
                if (!e.currentTarget.disabled) {
                  e.currentTarget.style.backgroundColor = "#004e3a";
                }
              }}
              onMouseLeave={(e) => {
                if (!e.currentTarget.disabled) {
                  e.currentTarget.style.backgroundColor = "#006e52";
                }
              }}
            >
              {isLoading || fetcher.state === "submitting" ? "Logging in..." : "Login"}
            </button>
          </form>

          <div style={{ 
            marginTop: "24px", 
            textAlign: "center",
            fontSize: "14px",
            color: "#6d7175"
          }}>
            Don't have an account? Contact your administrator.
          </div>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};