"use client";

import React, { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import Image from "next/image";
import { Icons } from "./sections/icons";

interface Row {
  rank: number;
  app: string;
  creator: string;
  url: string;
}

interface DiscoverMiniappsProps {
  projects?: any[];
  isLoading?: boolean;
}

// Dummy data with 10 items
const DUMMY_DATA: Record<"today" | "week" | "all", Row[]> = {
  today: [
    {
      rank: 1,
      app: "Farcaster Polls",
      creator: "@alice",
      url: "https://example.com/1",
    },
    {
      rank: 2,
      app: "NFT Gallery",
      creator: "@bob",
      url: "https://example.com/2",
    },
    {
      rank: 3,
      app: "Token Airdrop",
      creator: "@charlie",
      url: "https://example.com/3",
    },
    {
      rank: 4,
      app: "DeFi Dashboard",
      creator: "@diana",
      url: "https://example.com/4",
    },
    {
      rank: 5,
      app: "Social Feed",
      creator: "@eve",
      url: "https://example.com/5",
    },
    {
      rank: 6,
      app: "Voting DApp",
      creator: "@frank",
      url: "https://example.com/6",
    },
    {
      rank: 7,
      app: "Leaderboard",
      creator: "@grace",
      url: "https://example.com/7",
    },
    {
      rank: 8,
      app: "Marketplace",
      creator: "@henry",
      url: "https://example.com/8",
    },
    {
      rank: 9,
      app: "Staking App",
      creator: "@ivy",
      url: "https://example.com/9",
    },
    {
      rank: 10,
      app: "Gaming Hub",
      creator: "@jack",
      url: "https://example.com/10",
    },
  ],
  week: [
    {
      rank: 1,
      app: "Farcaster Polls",
      creator: "@alice",
      url: "https://example.com/1",
    },
    {
      rank: 2,
      app: "NFT Gallery",
      creator: "@bob",
      url: "https://example.com/2",
    },
    {
      rank: 3,
      app: "Token Airdrop",
      creator: "@charlie",
      url: "https://example.com/3",
    },
    {
      rank: 4,
      app: "DeFi Dashboard",
      creator: "@diana",
      url: "https://example.com/4",
    },
    {
      rank: 5,
      app: "Social Feed",
      creator: "@eve",
      url: "https://example.com/5",
    },
    {
      rank: 6,
      app: "Voting DApp",
      creator: "@frank",
      url: "https://example.com/6",
    },
    {
      rank: 7,
      app: "Leaderboard",
      creator: "@grace",
      url: "https://example.com/7",
    },
    {
      rank: 8,
      app: "Marketplace",
      creator: "@henry",
      url: "https://example.com/8",
    },
    {
      rank: 9,
      app: "Staking App",
      creator: "@ivy",
      url: "https://example.com/9",
    },
    {
      rank: 10,
      app: "Gaming Hub",
      creator: "@jack",
      url: "https://example.com/10",
    },
  ],
  all: [
    {
      rank: 1,
      app: "Farcaster Polls",
      creator: "@alice",
      url: "https://example.com/1",
    },
    {
      rank: 2,
      app: "NFT Gallery",
      creator: "@bob",
      url: "https://example.com/2",
    },
    {
      rank: 3,
      app: "Token Airdrop",
      creator: "@charlie",
      url: "https://example.com/3",
    },
    {
      rank: 4,
      app: "DeFi Dashboard",
      creator: "@diana",
      url: "https://example.com/4",
    },
    {
      rank: 5,
      app: "Social Feed",
      creator: "@eve",
      url: "https://example.com/5",
    },
    {
      rank: 6,
      app: "Voting DApp",
      creator: "@frank",
      url: "https://example.com/6",
    },
    {
      rank: 7,
      app: "Leaderboard",
      creator: "@grace",
      url: "https://example.com/7",
    },
    {
      rank: 8,
      app: "Marketplace",
      creator: "@henry",
      url: "https://example.com/8",
    },
    {
      rank: 9,
      app: "Staking App",
      creator: "@ivy",
      url: "https://example.com/9",
    },
    {
      rank: 10,
      app: "Gaming Hub",
      creator: "@jack",
      url: "https://example.com/10",
    },
  ],
};

const renderRankVisual = (rank: number) => {
  if (rank === 1) {
    return <Icons.firstIcon className="h-8 w-8" />;
  } else if (rank === 2) {
    return <Icons.secondIcon className="h-8 w-8" />;
  } else if (rank === 3) {
    return <Icons.thirdIcon className="h-8 w-8" />;
  } else {
    return <span className="font-semibold px-3 text-gray-500">{rank}</span>;
  }
};

export function DiscoverMiniapps({
  projects,
  isLoading,
}: DiscoverMiniappsProps) {
  const [tab] = useState<"today" | "week" | "all">("today");
  const rows = DUMMY_DATA[tab];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="blur pointer-events-none select-none">
        <Table className="[&_td]:align-top text-xs">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[72px]">#</TableHead>
              <TableHead>Miniapp</TableHead>
              <TableHead>Creator</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.rank}>
                <TableCell>{renderRankVisual(row.rank)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Image
                      src="/farcaster.svg"
                      alt="Farcaster"
                      width={20}
                      height={20}
                    />
                    <span className="font-medium">{row.app}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-gray-500">{row.creator}</span>
                </TableCell>
                <TableCell className="text-right">
                  <button
                    className="text-gray-600 bg-gray-100 border border-gray-200 rounded-full px-2.5 py-0.5 cursor-pointer text-sm font-semibold hover:bg-gray-200 transition-colors"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    Try
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-white/50 backdrop-blur-sm">
        <div className="text-center">
          <p className="text-2xl font-semibold text-gray-900 mb-2">Coming Soon</p>
          <p className="text-sm text-gray-600">We're working on something amazing</p>
        </div>
      </div>
    </div>
  );
}
