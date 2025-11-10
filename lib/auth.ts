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

export async function authenticatePrivyUser(privyUserId: string, email?: string, displayName?: string, pfpUrl?: string) {
  try {
    // Check if user exists, create if not
    let user = await getUserByPrivyId(privyUserId);
    
    if (!user) {
      try {
        // Create new user automatically
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
      
      if (email && email !== user.email) {
        updates.email = email;
      }
      if (displayName && displayName !== user.displayName) {
        updates.displayName = displayName;
      }
      if (pfpUrl !== undefined && pfpUrl !== user.pfpUrl) {
        updates.pfpUrl = pfpUrl;
      }
      
      // Only update if there are changes
      if (Object.keys(updates).length > 0) {
        user = await updateUser(user.id, updates);
        logger.log(`✅ Updated user profile: ${user.id}`, updates);
      }
    }

    // Create session token
    const sessionToken = uuidv4();
    const expiresAt = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hour

    await createUserSession(user.id, sessionToken, expiresAt);

    return {
      success: true,
      user: {
        id: user.id,
        privyUserId: user.privyUserId,
        email: user.email ?? undefined,
        displayName: user.displayName ?? undefined,
        pfpUrl: user.pfpUrl ?? undefined,
      },
      sessionToken,
    };
  } catch (error) {
    logger.error("Privy authentication error:", error);
    return {
      success: false,
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
