'use client';

import { useState, useEffect } from 'react';
import { Icons } from './sections/icons';
import { config } from '@/lib/config';

interface PasswordProtectionProps {
    onAuthenticated: () => void;
}

export function PasswordProtection({ onAuthenticated }: PasswordProtectionProps) {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');

        try {
            const response = await fetch('/api/auth', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ password }),
            });

            const data = await response.json();

            if (data.success) {
                // Store authentication with timestamp
                const authData = {
                    timestamp: Date.now()
                };
                localStorage.setItem(config.authKey, JSON.stringify(authData));
                onAuthenticated();
            } else {
                setError(data.message || 'Incorrect password. Please try again.');
                setPassword('');
            }
        } catch {
            setError('Network error. Please try again.');
            setPassword('');
        }

        setIsLoading(false);
    };

    // Check if already authenticated on mount
    useEffect(() => {
        const authData = localStorage.getItem(config.authKey);

        if (authData) {
            try {
                const { timestamp } = JSON.parse(authData);
                const now = Date.now();
                const timeDiff = now - timestamp;

                // Check if session has expired
                if (config.sessionTimeout && timeDiff > config.sessionTimeout) {
                    // Session expired, clear authentication
                    localStorage.removeItem(config.authKey);
                } else {
                    onAuthenticated();
                }
            } catch {
                // Invalid auth data, clear it
                localStorage.removeItem(config.authKey);
            }
        }
    }, [onAuthenticated]);

    return (
        <div className="min-h-screen bg-gradient-to-br from-pink-50 via-white to-blue-50 flex items-center justify-center p-6">
            <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full border border-gray-100">
                {/* Logo and Header */}
                <div className="text-center mb-8">
                    <div className="flex items-center justify-center gap-3 mb-4">
                        <Icons.earnySmallGrayIcon className="w-8 h-8 text-gray-600" />
                        <span className="text-2xl font-funnel-display font-semibold text-gray-900">Minidev</span>
                    </div>
                    <h1 className="text-xl font-funnel-sans font-medium text-gray-700 mb-2">
                        Access Required
                    </h1>
                    <p className="text-sm text-gray-500">
                        Enter the password to access the Minidev platform
                    </p>
                </div>

                {/* Password Form */}
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                            Password
                        </label>
                        <div className="relative">
                            <input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors font-funnel-sans text-gray-900 placeholder-gray-400"
                                placeholder="Enter password"
                                disabled={isLoading}
                                autoFocus
                            />
                            {isLoading && (
                                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                                    <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                                </div>
                            )}
                        </div>
                    </div>

                    {error && (
                        <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                            <div className="flex items-center gap-2">
                                <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                                <span className="text-sm text-red-700">{error}</span>
                            </div>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={isLoading || !password.trim()}
                        className="w-full bg-pink text-white py-3 px-4 rounded-xl font-funnel-sans font-medium hover:from-blue-700 hover:to-indigo-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isLoading ? 'Verifying...' : 'Access Platform'}
                    </button>
                </form>

                {/* Footer */}
                <div className="mt-8 text-center">
                    <p className="text-xs text-gray-400">
                        Protected by password authentication
                    </p>
                </div>
            </div>
        </div>
    );
} 