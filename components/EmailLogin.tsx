'use client';
import { logger } from '@/lib/logger';


import { useState, useRef, useEffect } from 'react';
import { useLoginWithEmail } from '@privy-io/react-auth';
import { Icons } from './sections/icons';

export function EmailLogin() {
    const [email, setEmail] = useState('');
    const [otp, setOtp] = useState(['', '', '', '', '', '']);
    const [isOtpSent, setIsOtpSent] = useState(false);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [activeOtpIndex, setActiveOtpIndex] = useState(0);
    const [isVerified, setIsVerified] = useState(false);
    const [isVerifying, setIsVerifying] = useState(false);
    const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

    // Privy hooks
    const { sendCode, loginWithCode } = useLoginWithEmail();

    const handleEmailSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');

        try {
            await sendCode({ email });
            setIsOtpSent(true);
            setActiveOtpIndex(0);
        } catch (error) {
            setError('Failed to send OTP. Please try again.');
            logger.error('Error sending code:', error);
        }

        setIsLoading(false);
    };

    useEffect(() => {
        setError('');
    }, [otp]);

    const handleOtpSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');

        const otpString = otp.join('');

        try {
            await loginWithCode({ code: otpString });
            setIsVerified(true);

            // Show success message for a few seconds
            setTimeout(() => {
                setIsVerified(false);
            }, 3000);

        } catch (error) {
            setError('Invalid OTP');
            setOtp(['', '', '', '', '', '']);
            logger.log('Error logging in with code:', error);
        }

        setIsLoading(false);
    };

    const handleOtpChange = (index: number, value: string) => {
        // Only allow single digit input
        if (value.length > 1) return;

        // Only allow numeric input
        if (value && !/^\d$/.test(value)) return;

        const newOtp = [...otp];
        newOtp[index] = value;
        setOtp(newOtp);

        // Reset verification status when OTP is changed
        setIsVerified(false);

        // Auto-focus next input if a digit was entered
        if (value && index < 5) {
            setTimeout(() => {
                otpRefs.current[index + 1]?.focus();
                setActiveOtpIndex(index + 1);
            }, 10);
        }

        // Auto-verify when all 6 digits are entered
        const updatedOtp = [...newOtp];
        if (updatedOtp.every(digit => digit !== '') && updatedOtp.join('').length === 6) {
            setTimeout(() => {
                handleAutoVerify(updatedOtp.join(''));
            }, 100); // Small delay to ensure state is updated
        }
    };

    const handleAutoVerify = async (otpString: string) => {
        if (isVerifying) return;

        setIsVerifying(true);
        setError('');

        try {
            await loginWithCode({ code: otpString }).then(() => {
                logger.log('OTP verified');
                setIsVerified(true);
                setTimeout(() => {
                    setIsVerified(false);
                    logger.log('timeout check');
                }, 3000);
            });

        } catch (error) {
            setError('Invalid OTP. Please try again.');
            setIsVerified(false);
            logger.log('Error auto-verifying code:', error);
        }

        setIsVerifying(false);
    };

    const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
        if (e.key === 'Backspace') {
            if (!otp[index] && index > 0) {
                // If current input is empty and backspace is pressed, go to previous input
                const prevInput = otpRefs.current[index - 1];
                if (prevInput) {
                    prevInput.focus();
                }
                setActiveOtpIndex(index - 1);
            } else if (otp[index]) {
                // If current input has a value, clear it
                const newOtp = [...otp];
                newOtp[index] = '';
                setOtp(newOtp);
                setIsVerified(false); // Reset verification status when OTP is changed
            }
        }
    };

    const handleOtpPaste = (e: React.ClipboardEvent) => {
        e.preventDefault();
        const pastedData = e.clipboardData.getData('text');
        const digits = pastedData.replace(/\D/g, '').slice(0, 6);

        if (digits.length > 0) {
            const newOtp = [...otp];

            // Fill the OTP array with the pasted digits
            for (let i = 0; i < 6; i++) {
                newOtp[i] = digits[i] || '';
            }

            setOtp(newOtp);

            // Set focus to the next empty input or the last input
            const nextEmptyIndex = newOtp.findIndex(digit => !digit);
            setActiveOtpIndex(nextEmptyIndex !== -1 ? nextEmptyIndex : 5);

            // Auto-verify if all 6 digits are filled
            if (digits.length === 6) {
                setTimeout(() => {
                    handleAutoVerify(digits);
                }, 100); // Small delay to ensure state is updated
            }
        }
    };

    const handleResendOtp = async () => {
        setIsLoading(true);
        setError('');

        try {
            await sendCode({ email });
            setOtp(['', '', '', '', '', '']);
            setActiveOtpIndex(0);
        } catch (error) {
            setError('Failed to resend OTP. Please try again.');
            logger.error('Error resending code:', error);
        }

        setIsLoading(false);
    };

    const goBackToEmail = () => {
        setIsOtpSent(false);
        setEmail('');
        setOtp(['', '', '', '', '', '']);
        setError('');
    };

    // Privy handles authentication state, no need to check localStorage

    return (
        <div className="min-h-screen relative flex items-center justify-center p-6 overflow-hidden font-funnel-sans">
            {/* Background with grid pattern inspired by home page */}
            <div className="absolute inset-0 bg-[#0A0B1A]"></div>
            <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[length:25px_25px]"></div>

            {/* Subtle gradient overlay */}
            {/* <div className="absolute inset-0 bg-gradient-to-br from-[#D76CEF]/10 via-transparent to-[#FE6C11]/5"></div> */}

            <div className="relative bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl p-8 max-w-md w-full border border-white/20">
                {/* Back Arrow - Only show on OTP screen */}
                {isOtpSent && (
                    <button
                        onClick={goBackToEmail}
                        className="absolute top-6 left-6 p-2 rounded-full bg-gray-200 hover:bg-gray-300 transition-colors cursor-pointer"
                        aria-label="Go back to email"
                    >
                        <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                )}

                {/* Logo and Header */}
                <div className="text-center mb-8">
                    <div className="flex items-center justify-center gap-3 mb-4">
                        <Icons.earnySmallGrayIcon className="w-7 h-7 text-gray-900" />
                        <span className="text-3xl font-funnel-display font-bold text-gray-900">Minidev</span>
                    </div>
                    <h1 className="text-xl font-funnel-sans font-medium text-gray-700 mb-2">
                        {isOtpSent ? 'Enter confirmation code' : 'Continue with Email'}
                    </h1>
                    {isOtpSent ? <p className="text-sm text-gray-500">
                        Please check <strong>{email}</strong> for an email from privy.io and enter your code below.
                    </p> :
                        <p className="text-sm text-gray-500">
                            Enter your email address to receive a verification code
                        </p>
                    }
                </div>

                {/* Email Form */}
                {!isOtpSent && (
                    <form onSubmit={handleEmailSubmit} className="space-y-6">
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                                Email Address
                            </label>
                            <div className="relative">
                                <input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#D76CEF] focus:border-[#D76CEF] focus:outline-none transition-colors font-funnel-sans text-gray-900 placeholder-gray-400 bg-white/80 backdrop-blur-sm"
                                    placeholder="Enter your email"
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
                            disabled={isLoading || !email.trim()}
                            className="w-full bg-[#FE6C11] text-white py-3 px-4 rounded-xl font-funnel-sans font-medium hover:bg-[#FE6C11]/80 focus:ring-2 focus:ring-[#FE6C11]/50 focus:ring-offset-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg cursor-pointer"
                            style={{ boxShadow: '0 4px 24px 0 rgba(255, 115, 0, 0.15)' }}
                        >
                            {isLoading ? 'Sending...' : 'Send Code'}
                        </button>
                    </form>
                )}

                {/* OTP Form */}
                {isOtpSent && (
                    <form onSubmit={handleOtpSubmit} className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-center text-gray-700 mb-4">
                                Verification Code
                            </label>

                            {/* Success Message */}
                            {isVerified && (
                                <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-4">
                                    <div className="flex items-center gap-2">
                                        <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                        </svg>
                                        <span className="text-sm text-green-700 font-medium">Successful</span>
                                    </div>
                                </div>
                            )}
                            <div className="flex gap-2 justify-center">
                                {otp.map((digit, index) => (
                                    <input
                                        key={index}
                                        ref={(el) => {
                                            otpRefs.current[index] = el;
                                        }}
                                        type="text"
                                        maxLength={1}
                                        value={digit}
                                        onChange={(e) => handleOtpChange(index, e.target.value)}
                                        onKeyDown={(e) => handleOtpKeyDown(index, e)}
                                        onPaste={handleOtpPaste}
                                        onFocus={() => setActiveOtpIndex(index)}
                                        className={`w-12 h-12 text-center border-2 rounded-lg text-black text-lg font-semibold focus:ring-1 focus:ring-[#D76CEF] focus:border-[#D76CEF] focus:outline-none transition-colors bg-white/80 backdrop-blur-sm ${isVerified
                                            ? 'border-green-500 bg-green-50'
                                            : index === activeOtpIndex
                                                ? 'border-[#D76CEF]'
                                                : 'border-gray-300'
                                            }`}
                                        disabled={isLoading}
                                        autoFocus={index === 0}
                                    />
                                ))}
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



                        <div className="text-center">
                            <span className="text-sm text-gray-500">
                                Didn&apos;t get an email?{' '}
                            </span>
                            <button
                                type="button"
                                onClick={handleResendOtp}
                                disabled={isLoading}
                                className="text-sm text-blue-600 hover:text-blue-700 underline transition-colors disabled:opacity-50 cursor-pointer"
                            >
                                Resend code
                            </button>
                        </div>
                    </form>
                )}

                {/* Footer */}
                <div className="mt-8 text-center">
                    <p className="text-xs text-gray-400">
                        Protected by <strong>Privy.io</strong>
                    </p>
                </div>
            </div>
        </div>
    );
} 