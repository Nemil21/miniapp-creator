'use client';

import Image from 'next/image';

interface FarcasterMigrationModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function FarcasterMigrationModal({ isOpen, onClose }: FarcasterMigrationModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl max-w-md w-full overflow-hidden shadow-xl">
                {/* Header with close button */}
                <div className="flex items-center justify-end p-4 pb-0">
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500 hover:text-gray-900 cursor-pointer"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="px-6 pb-6 pt-2">
                    {/* Farcaster Logo */}
                    <div className="flex justify-center mb-6">
                        <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center">
                            <Image
                                src="/farcaster.svg"
                                alt="Farcaster"
                                width={32}
                                height={32}
                            />
                        </div>
                    </div>

                    {/* Title */}
                    <h2 className="text-xl font-bold text-black text-center mb-3">
                        Feature Migrated
                    </h2>

                    {/* Message */}
                    <p className="text-gray-600 text-center mb-6 leading-relaxed">
                        We have migrated Farcaster mini app generation to our Minidev Farcaster miniapp. Please click the button below to be redirected there.
                    </p>

                    {/* Redirect Button */}
                    <a
                        href="https://farcaster.xyz/miniapps/P68U4iBooFqF/minidev"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block w-full px-6 py-3 bg-black text-white text-center rounded-xl font-medium hover:bg-gray-800 transition-colors cursor-pointer"
                    >
                        Go to Minidev
                    </a>

                    {/* Cancel link */}
                    <button
                        onClick={onClose}
                        className="block w-full mt-3 px-6 py-2 text-gray-500 text-center text-sm hover:text-gray-700 transition-colors cursor-pointer"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}

