import { logger } from "../../../../lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { authenticatePrivyUser } from "../../../../lib/auth";

export async function POST(request: NextRequest) {
  try {
    const { privyUserId, email, displayName, pfpUrl } = await request.json();

    if (!privyUserId) {
      return NextResponse.json(
        { success: false, message: "Privy user ID is required" },
        { status: 400 }
      );
    }

    const result = await authenticatePrivyUser(privyUserId, email, displayName, pfpUrl);
    
    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    logger.error("Auth error:", error);
    return NextResponse.json(
      { success: false, message: "Authentication failed" },
      { status: 500 }
    );
  }
}

