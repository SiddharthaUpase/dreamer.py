// Auth Proxy Edge Function
// Handles Google OAuth flow and returns ID token to user apps.
// This allows any preview URL to use Google Sign-In without registering each origin.
//
// Flow:
// 1. User app opens popup to: /auth-proxy?redirect=https://xxx.preview.bl.run/auth/callback
// 2. This function redirects to Google OAuth
// 3. Google sends user back to: /auth-proxy?action=callback&code=xxx&state=...
// 4. This function exchanges code for ID token
// 5. Redirects to user app with the ID token

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

// These are set as Edge Function secrets
const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

// The public URL of this edge function (Deno's req.url doesn't include /functions/v1/)
const SUPABASE_REF = "fvneowbofepnkauyhrqi";
const FUNCTION_URL = `https://${SUPABASE_REF}.supabase.co/functions/v1/auth-proxy`;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  // Step 1: Start OAuth flow
  if (!action || action === "start") {
    const redirect = url.searchParams.get("redirect");
    if (!redirect) {
      return new Response("Missing ?redirect= parameter", { status: 400 });
    }

    // Build the callback URL (same function, action=callback)
    const callbackUrl = `${FUNCTION_URL}?action=callback`;

    // Encode the user app's redirect URL in state
    const state = btoa(JSON.stringify({ redirect }));

    const googleUrl = new URL(GOOGLE_AUTH_URL);
    googleUrl.searchParams.set("client_id", CLIENT_ID);
    googleUrl.searchParams.set("redirect_uri", callbackUrl);
    googleUrl.searchParams.set("response_type", "code");
    googleUrl.searchParams.set("scope", "openid email profile");
    googleUrl.searchParams.set("state", state);
    googleUrl.searchParams.set("access_type", "online");
    googleUrl.searchParams.set("prompt", "select_account");

    return Response.redirect(googleUrl.toString(), 302);
  }

  // Step 2: Handle callback from Google
  if (action === "callback") {
    const code = url.searchParams.get("code");
    const stateParam = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      return new Response(`Google OAuth error: ${error}`, { status: 400 });
    }

    if (!code || !stateParam) {
      return new Response("Missing code or state", { status: 400 });
    }

    // Decode state to get the user app's redirect URL
    let redirect: string;
    try {
      const state = JSON.parse(atob(stateParam));
      redirect = state.redirect;
    } catch {
      return new Response("Invalid state parameter", { status: 400 });
    }

    // Exchange authorization code for tokens
    const callbackUrl = `${FUNCTION_URL}?action=callback`;

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: callbackUrl,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      return new Response(`Token exchange failed: ${errText}`, { status: 500 });
    }

    const tokens = await tokenRes.json();
    const idToken = tokens.id_token;

    if (!idToken) {
      return new Response("No ID token in response", { status: 500 });
    }

    // Redirect to user app with the ID token
    const redirectUrl = new URL(redirect);
    redirectUrl.searchParams.set("id_token", idToken);

    return Response.redirect(redirectUrl.toString(), 302);
  }

  return new Response("Unknown action", { status: 400 });
});
