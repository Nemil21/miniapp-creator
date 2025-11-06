import { logger } from "../../../../lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "../../../../lib/auth";

export async function GET(request: NextRequest) {
  try {
    const { user, isAuthorized, error } = await authenticateRequest(request);
    
    if (!isAuthorized || !user) {
      return NextResponse.json(
        { error: error || "Authentication required" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      user,
    });
  } catch (error) {
    logger.error("Session verification error:", error);
    return NextResponse.json(
      { error: "Session verification failed" },
      { status: 500 }
    );
  }
}
