'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { useAuthContext } from '../contexts/AuthContext';
import { usePrivy, useWallets } from '@privy-io/react-auth';

interface UserProfileHeaderProps {
  onOpenSidebar?: () => void;
}

export function UserProfileHeader({ onOpenSidebar }: UserProfileHeaderProps) {
  const { user } = useAuthContext();
  const { linkFarcaster, logout, user: privyUser } = usePrivy();
  const { wallets } = useWallets();
  const walletAddress = wallets[0]?.address;
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Check if Farcaster is connected
  const hasFarcaster = privyUser?.linkedAccounts?.some(
    (account) => account.type === 'farcaster'
  ) || false;
  
  // Check if Farcaster is enabled in Privy config (temporary check)
  const farcasterEnabled = process.env.NEXT_PUBLIC_FARCASTER_ENABLED === 'true';

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDropdown]);

  // Format wallet address
  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  // Get user display name
  const getUserDisplay = () => {
    if (user?.displayName) return user.displayName;
    if (user?.email) return user.email;
    return user?.privyUserId || 'minidev_user';
  };
  
  // Get user profile picture URL
  const getUserPfpUrl = () => {
    return user?.pfpUrl;
  };

  const handleLinkFarcaster = async () => {
    try {
      await linkFarcaster();
      setShowDropdown(false);
      // The useAuth hook will automatically detect the new linked account
      // and refresh the user data
    } catch (error) {
      console.error('Failed to link Farcaster:', error);
      // Show user-friendly error message
      alert('Unable to connect Farcaster. Please make sure:\n1. Farcaster is enabled in your Privy Dashboard\n2. You have the Warpcast app installed\n3. Try refreshing the page');
    }
  };

  const handleLogout = () => {
    logout();
    setShowDropdown(false);
  };

  return (
    <div className="sticky top-0 left-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between z-20">
      <div className="flex items-center gap-3">
        {/* Sidebar Toggle Button */}
        <button
          onClick={onOpenSidebar}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          title="Toggle Projects"
        >
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* User Profile - Clickable with Dropdown */}
        <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="flex items-center gap-3 hover:bg-gray-50 rounded-lg px-2 py-1 transition-colors"
        >
          {getUserPfpUrl() ? (
            <Image 
              src={getUserPfpUrl()!} 
              alt="Profile"
              width={40}
              height={40}
              className="w-10 h-10 rounded-full object-cover"
              unoptimized
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <span className="text-white font-medium text-sm">
                {getUserDisplay().charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <div className="flex flex-col text-left">
            <span className="text-sm font-medium text-black">
              {getUserDisplay()}
            </span>
            {walletAddress && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-black-60 font-mono">
                  {formatAddress(walletAddress)}
                </span>
                <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] rounded-full font-medium">
                  Base
                </span>
              </div>
            )}
          </div>
          {/* Dropdown Arrow */}
          <svg 
            className={`w-4 h-4 text-gray-600 transition-transform ${showDropdown ? 'rotate-180' : ''}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Dropdown Menu */}
        {showDropdown && (
          <div className="absolute top-full left-0 mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-lg py-2 z-50">
            {/* Logout Option */}
            <button
              onClick={handleLogout}
              className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-red-50 transition-colors text-left"
            >
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="text-sm font-medium text-red-600">Logout</span>
            </button>
          </div>
        )}
        </div>
      </div>

      {/* Connect Farcaster Button - Only show if enabled and not connected */}
      {!hasFarcaster && farcasterEnabled && (
        <button
          onClick={handleLinkFarcaster}
            className="px-4 py-2 bg-transparent border-2 border-[#8A63D2] hover:bg-[#8A63D2]/10 text-[#8A63D2] text-sm font-medium rounded-full transition-colors flex items-center gap-2"
        >
          <Image src="/farcaster.svg" alt="Farcaster" width={16} height={16} className="w-4 h-4" />
          Connect Farcaster
        </button>
      )}
    </div>
  );
}

