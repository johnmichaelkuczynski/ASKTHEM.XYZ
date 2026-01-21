import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { storage } from "./storage";

export function setupGoogleAuth(): boolean {
  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  
  if (!clientID || !clientSecret) {
    console.log("[Google Auth] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
    return false;
  }

  const baseUrl = process.env.BASE_URL || "https://askthem.xyz";
  const callbackURL = `${baseUrl}/api/auth/google/callback`;
  
  console.log(`[Google Auth] Configuring with callback URL: ${callbackURL}`);

  passport.use(
    new GoogleStrategy(
      {
        clientID,
        clientSecret,
        callbackURL,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          const displayName = profile.displayName || email?.split("@")[0] || "User";
          const profileImage = profile.photos?.[0]?.value;

          const user = await storage.createOrGetUserByGoogleId({
            googleId: profile.id,
            email,
            displayName,
            profileImage,
          });

          done(null, user);
        } catch (error) {
          console.error("[Google Auth] Error in strategy callback:", error);
          done(error as Error);
        }
      }
    )
  );

  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user || null);
    } catch (error) {
      done(error);
    }
  });

  return true;
}
