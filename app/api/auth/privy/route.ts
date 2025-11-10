import { logger } from "../../../../lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { authenticatePrivyUser } from "../../../../lib/auth";

export async function POST(request: NextRequest) {
  try {
    const { privyUserId, email, displayName, pfpUrl } = await request.json();

    console.log('📨 [API /auth/privy] Received auth request:', {
      privyUserId,
      email,
      displayName,
      pfpUrl
    });

    if (!privyUserId) {
      return NextResponse.json(
        { success: false, message: "Privy user ID is required" },
        { status: 400 }
      );
    }

    const result = await authenticatePrivyUser(privyUserId, email, displayName, pfpUrl);
    
    if (!result.success) {
      console.log('❌ [API /auth/privy] Auth failed:', result.error);
      return NextResponse.json(
        { success: false, message: result.error },
        { status: 500 }
      );
    }
    
    console.log('📤 [API /auth/privy] Auth result:', {
      success: result.success,
      user: {
        id: result.user.id,
        displayName: result.user.displayName,
        pfpUrl: result.user.pfpUrl,
        email: result.user.email
      }
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error("Auth error:", error);
    return NextResponse.json(
      { success: false, message: "Authentication failed" },
      { status: 500 }
    );
  }
}
