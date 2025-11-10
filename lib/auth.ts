import { logger } from "./logger";
import { NextRequest, NextResponse } from "next/server";
import { getUserBySessionToken, getUserByPrivyId, createUser, createUserSession, updateUser } from "./database";
import { v4 as uuidv4 } from "uuid";

export interface User {
  id: string;
  privyUserId: string;
  email?: string;
  displayName?: string;
  pfpUrl?: string;
}


export interface AuthenticatedRequest extends NextRequest {
  user?: User;
  isAuthorized?: boolean;
}

export async function authenticateRequest(request: NextRequest): Promise<{
  user: User | null;
  isAuthorized: boolean;
  error?: string;
}> {
  try {
    // Get session token from Authorization header
    const sessionToken = request.headers.get("authorization")?.replace("Bearer ", "");
    
    if (!sessionToken) {
      return {
        user: null,
        isAuthorized: false,
        error: "No session token provided"
      };
    }

    // Verify session token and get user
    const user = await getUserBySessionToken(sessionToken);
    
    if (!user) {
      return {
        user: null,
        isAuthorized: false,
        error: "Invalid session token"
      };
    }

    // Check if session is expired
    if (user.expiresAt && new Date() > new Date(user.expiresAt)) {
      return {
        user: null,
        isAuthorized: false,
        error: "Session expired"
      };
    }

    return {
      user: {
        id: user.id,
        privyUserId: user.privyUserId,
        email: user.email ?? undefined,
        displayName: user.displayName ?? undefined,
        pfpUrl: user.pfpUrl ?? undefined,
      },
      isAuthorized: true
    };
  } catch (error) {
    logger.error("Authentication error:", error);
    return {
      user: null,
      isAuthorized: false,
      error: "Authentication failed"
    };
  }
}

export async function authenticatePrivyUser(
  privyUserId: string, 
  email?: string, 
  displayName?: string, 
  pfpUrl?: string
): Promise<
  | { success: true; user: User; sessionToken: string }
  | { success: false; error: string }
> {
  try {
    console.log('🔐 [auth.ts] authenticatePrivyUser called with:', {
      privyUserId,
      email,
      displayName,
      pfpUrl
    });
    
    // Check if user exists, create if not
    let user = await getUserByPrivyId(privyUserId);
    
    console.log('🔍 [auth.ts] Existing user found:', user ? {
      id: user.id,
      displayName: user.displayName,
      pfpUrl: user.pfpUrl,
      email: user.email
    } : null);
    
    if (!user) {
      try {
        // Create new user automatically
        console.log('➕ [auth.ts] Creating new user...');
        user = await createUser(privyUserId, email, displayName, pfpUrl);
        logger.log(`✅ Created new user: ${user.id}`);
      } catch (createError: unknown) {
        // Handle duplicate key constraint - user was created by another request
        if ((createError as { code?: string; constraint?: string })?.code === '23505' && (createError as { code?: string; constraint?: string })?.constraint === 'users_privy_user_id_unique') {
          logger.log(`⚠️ User already exists (race condition), fetching existing user: ${privyUserId}`);
          user = await getUserByPrivyId(privyUserId);
          if (!user) {
            throw new Error("Failed to create or fetch user");
          }
        } else {
          throw createError;
        }
      }
    } else {
      // User exists - update their profile information if new data is provided
      const updates: { email?: string; displayName?: string; pfpUrl?: string } = {};
      
      console.log('🔄 [auth.ts] Comparing values for updates:', {
        email: { new: email, old: user.email, different: email !== user.email },
        displayName: { new: displayName, old: user.displayName, different: displayName !== user.displayName },
        pfpUrl: { new: pfpUrl, old: user.pfpUrl, different: pfpUrl !== user.pfpUrl }
      });
      
      if (email && email !== user.email) {
        updates.email = email;
      }
      if (displayName && displayName !== user.displayName) {
        updates.displayName = displayName;
      }
      // Allow pfpUrl to be set to undefined to clear it when disconnecting Farcaster
      if (pfpUrl !== user.pfpUrl) {
        updates.pfpUrl = pfpUrl;
      }
      
      console.log('📝 [auth.ts] Updates to apply:', updates);
      
      // Only update if there are changes
      if (Object.keys(updates).length > 0) {
        console.log('💾 [auth.ts] Applying updates to database...');
        user = await updateUser(user.id, updates);
        console.log('✅ [auth.ts] Updated user profile from DB:', {
          id: user.id,
          displayName: user.displayName,
          pfpUrl: user.pfpUrl,
          email: user.email
        });
        logger.log(`✅ Updated user profile: ${user.id}`, updates);
      } else {
        console.log('⏭️  [auth.ts] No updates needed, user data is up to date');
      }
    }

    console.log('📦 [auth.ts] Final user object before returning:', {
      id: user.id,
      displayName: user.displayName,
      pfpUrl: user.pfpUrl,
      email: user.email
    });

    // Create session token
    const sessionToken = uuidv4();
    const expiresAt = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hour

    await createUserSession(user.id, sessionToken, expiresAt);

    const returnData = {
      success: true as const,
      user: {
        id: user.id,
        privyUserId: user.privyUserId,
        email: user.email ?? undefined,
        displayName: user.displayName ?? undefined,
        pfpUrl: user.pfpUrl ?? undefined,
      },
      sessionToken,
    };
    
    console.log('📤 [auth.ts] Returning to API:', returnData);
    
    return returnData;
  } catch (error) {
    logger.error("Privy authentication error:", error);
    return {
      success: false as const,
      error: "Authentication failed"
    };
  }
}
export function requireAuth<T extends unknown[]>(
  handler: (request: NextRequest, ...args: T) => Promise<NextResponse>
) {
  return async (request: NextRequest, ...args: T): Promise<NextResponse> => {
    const { user, isAuthorized, error } = await authenticateRequest(request);
    
    if (!isAuthorized || !user) {
      return NextResponse.json(
        { error: error || "Authentication required" },
        { status: 401 }
      );
    }

    // Add user to request context
    (request as AuthenticatedRequest).user = user;
    (request as AuthenticatedRequest).isAuthorized = true;
    
    return handler(request, ...args);
  };
}
