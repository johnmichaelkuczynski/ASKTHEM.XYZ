import passport from "passport";
import { Strategy as GoogleStrategy, Profile } from "passport-google-oauth20";
import { storage } from "./storage";

export function setupGoogleAuth() {
  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientID || !clientSecret) {
    console.log("[Google Auth] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not configured - Google login disabled");
    return false;
  }

  // Determine callback URL based on environment
  let callbackURL: string;
  if (process.env.GOOGLE_CALLBACK_URL) {
    // Explicitly configured callback URL (for production)
    callbackURL = process.env.GOOGLE_CALLBACK_URL;
  } else if (process.env.REPLIT_DEPLOYMENT === "1") {
    // Production deployment - use the deployment domain
    const deploymentDomain = process.env.REPLIT_DEV_DOMAIN?.replace("-00-", "-") || "";
    callbackURL = `https://${deploymentDomain}/api/auth/google/callback`;
  } else if (process.env.REPLIT_DOMAINS) {
    // Development environment with Replit domains
    callbackURL = `https://${process.env.REPLIT_DOMAINS.split(",")[0]}/api/auth/google/callback`;
  } else {
    // Local development fallback
    callbackURL = "http://localhost:5000/api/auth/google/callback";
  }

  console.log("[Google Auth] Configuring with callback URL:", callbackURL);

  passport.use(
    new GoogleStrategy(
      {
        clientID,
        clientSecret,
        callbackURL,
      },
      async (
        accessToken: string,
        refreshToken: string,
        profile: Profile,
        done: (error: any, user?: any) => void
      ) => {
        try {
          const email = profile.emails?.[0]?.value;
          const displayName = profile.displayName || profile.name?.givenName || "User";
          const googleId = profile.id;
          const profileImage = profile.photos?.[0]?.value;

          const user = await storage.createOrGetUserByGoogleId({
            googleId,
            email: email || undefined,
            displayName,
            profileImage,
          });

          done(null, user);
        } catch (error) {
          console.error("[Google Auth] Error in strategy callback:", error);
          done(error);
        }
      }
    )
  );

  passport.serializeUser((user: any, done) => {
    done(null, { id: user.id, username: user.username });
  });

  passport.deserializeUser((serialized: { id: string; username: string }, done) => {
    done(null, serialized);
  });

  return true;
}
