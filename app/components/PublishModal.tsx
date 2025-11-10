'use client';
import { logger } from "../../lib/logger";


import { useState, useEffect } from 'react';
import { useAuthContext } from '../contexts/AuthContext';
import { sdk } from '@farcaster/miniapp-sdk';

interface PublishModalProps {
    isOpen: boolean;
    onClose: () => void;
    projectUrl?: string;
    projectId?: string;
}

export function PublishModal({ isOpen, onClose, projectUrl, projectId }: PublishModalProps) {
    const [currentStep, setCurrentStep] = useState(1);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [manifestUrl, setManifestUrl] = useState<string | null>(null);
    const [sdkReady, setSdkReady] = useState(false);
    
    // Get authentication from context
    const { sessionToken, isAuthenticated } = useAuthContext();

    // Initialize Farcaster SDK
    useEffect(() => {
        const initSdk = async () => {
            try {
                logger.log('🔧 Initializing Farcaster SDK...');
                const context = await sdk.context;
                
                // Check if we have a valid context with user info
                // The context needs to have user data for signing to work
                if (context && context.user) {
                    setSdkReady(true);
                    logger.log('✅ Farcaster SDK initialized with user context:', {
                        fid: context.user.fid,
                        username: context.user.username
                    });
                } else {
                    logger.log('⚠️ SDK loaded but no user context - not in Farcaster frame');
                    setSdkReady(false);
                }
            } catch (error) {
                logger.error('❌ Failed to initialize Farcaster SDK:', error);
                // SDK might not be available outside of Farcaster frame
                setSdkReady(false);
            }
        };
        
        if (isOpen) {
            initSdk();
        }
    }, [isOpen]);

    // Form fields
    const [formData, setFormData] = useState({
        name: '',
        iconUrl: '',
        description: '',
        homeUrl: projectUrl || '',
        splashImageUrl: '',
        splashBackgroundColor: '#ffffff'
    });

    // Form validation
    const validateForm = () => {
        if (!formData.name.trim()) {
            setError('App name is required');
            return false;
        }
        if (!formData.iconUrl.trim()) {
            setError('Icon URL is required');
            return false;
        }
        if (!formData.homeUrl.trim()) {
            setError('Home URL is required');
            return false;
        }
        // Validate URLs
        try {
            new URL(formData.iconUrl);
            new URL(formData.homeUrl);
            if (formData.splashImageUrl && formData.splashImageUrl.trim()) {
                new URL(formData.splashImageUrl);
            }
        } catch {
            setError('Please provide valid URLs');
            return false;
        }
        return true;
    };

    // Handle direct publish (without Farcaster SDK)
    const handleSignAndPublish = async () => {
        logger.log('handleSignAndPublish called with:', { projectId, projectUrl, formData });

        if (!validateForm()) return;

        if (!projectId) {
            logger.error('❌ Project ID is missing');
            setError('Project ID is missing. Please ensure your project is loaded correctly.');
            return;
        }

        if (!projectUrl) {
            logger.error('❌ Project URL is missing');
            setError('Project URL is missing. Please ensure your project is deployed.');
            return;
        }

        setIsLoading(true);
        setError(null);
        setCurrentStep(2); // Move to publishing step

        try {
            logger.log('📦 Step 1: Building manifest object...');
            
            // Build base manifest structure
            const baseManifest = {
                miniapp: {
                    version: 'vNext',
                    name: formData.name,
                    iconUrl: formData.iconUrl,
                    homeUrl: formData.homeUrl,
                    ...(formData.description && { description: formData.description }),
                    ...(formData.splashImageUrl && {
                        splashImageUrl: formData.splashImageUrl,
                        splashBackgroundColor: formData.splashBackgroundColor
                    })
                }
            };

            logger.log('✅ Base manifest built:', JSON.stringify(baseManifest, null, 2));

            // Sign manifest with Farcaster SDK (if available)
            logger.log('✍️ Step 2: Preparing manifest...');
            let manifest;
            
            if (sdkReady) {
                // We're in a Farcaster frame - sign with SDK
                logger.log('📱 Running in Farcaster frame - will sign with SDK');
                try {
                    // Extract domain from homeUrl
                    const homeUrlObj = new URL(formData.homeUrl);
                    const domain = homeUrlObj.hostname;
                    logger.log('🌐 Extracted domain:', domain);
                    
                    // Use SDK to sign the domain manifest with user's FID
                    // See: https://miniapps.farcaster.xyz/docs/sdk/actions/sign-manifest
                    const accountAssociation = await sdk.experimental.signManifest({
                        domain: domain
                    });
                    
                    logger.log('✅ Manifest signed successfully:', accountAssociation);
                    
                    if (!accountAssociation || !accountAssociation.header || !accountAssociation.payload || !accountAssociation.signature) {
                        throw new Error('Failed to sign manifest. Incomplete signature returned.');
                    }
                    
                    // Combine base manifest with signature
                    manifest = {
                        accountAssociation: {
                            header: accountAssociation.header,
                            payload: accountAssociation.payload,
                            signature: accountAssociation.signature
                        },
                        ...baseManifest
                    };
                    
                    logger.log('📝 Complete signed manifest:', JSON.stringify(manifest, null, 2));
                } catch (signError: unknown) {
                    logger.error('❌ Signing error:', signError);
                    
                    // Handle specific error types from the SDK
                    const errorConstructorName = (signError as { constructor?: { name?: string } })?.constructor?.name;
                    const errorMessage = (signError as { message?: string })?.message;
                    
                    if (errorConstructorName === 'RejectedByUser') {
                        throw new Error('You declined to sign the manifest. Please try again and approve the signing request.');
                    } else if (errorConstructorName === 'InvalidDomain') {
                        throw new Error('Invalid domain format in your app URL. Please check the Home URL.');
                    } else if (errorConstructorName === 'GenericError') {
                        throw new Error(`Signing failed: ${errorMessage || 'This could be due to host restrictions or network issues.'}`);
                    }
                    
                    // If SDK signing fails, fall back to unsigned manifest
                    logger.log('⚠️ SDK signing failed, falling back to unsigned manifest');
                    manifest = {
                        accountAssociation: null,
                        ...baseManifest
                    };
                    logger.log('📝 Using unsigned manifest as fallback:', JSON.stringify(manifest, null, 2));
                }
            } else {
                // Not in Farcaster frame - publish without SDK signature
                logger.log('🌐 Not in Farcaster frame - publishing without SDK signature');
                logger.log('ℹ️ Note: To sign with your Farcaster account, open this app in Warpcast');
                
                // Publish without accountAssociation (server supports this)
                manifest = {
                    accountAssociation: null,
                    ...baseManifest
                };
                
                logger.log('📝 Complete manifest (unsigned):', JSON.stringify(manifest, null, 2));
            }

            // Send to API for server-side processing
            logger.log('🌐 Step 3: Checking authentication...');
            if (!isAuthenticated || !sessionToken) {
                logger.error('❌ Not authenticated');
                throw new Error('Not authenticated. Please sign in first.');
            }
            logger.log('✅ Authentication verified');
            logger.log('Session token available:', !!sessionToken);

            logger.log('📤 Step 4: Sending signed manifest to API...', {
                endpoint: '/api/publish',
                projectId,
                hasManifest: !!manifest,
                hasSessionToken: !!sessionToken
            });

            const response = await fetch('/api/publish', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${sessionToken}`
                },
                body: JSON.stringify({
                    projectId,
                    manifest
                })
            });

            logger.log('API response status:', response.status);
            logger.log('API response headers:', response.headers);

            if (!response.ok) {
                // Try to get error details from response
                let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error || errorMessage;
                    logger.error('API error response:', errorData);
                } catch (parseError) {
                    // Response might not be JSON
                    logger.error('Failed to parse error response as JSON:', parseError);
                    const textError = await response.text();
                    logger.error('API error (non-JSON):', textError);
                    errorMessage = textError || errorMessage;
                }
                throw new Error(errorMessage);
            }

            const result = await response.json();
            logger.log('API response body:', result);

            if (!result || typeof result !== 'object') {
                throw new Error('Invalid response format from server');
            }

            if (!result.success) {
                throw new Error(result.error || 'Failed to publish');
            }

            logger.log('Publish successful:', result);
            setManifestUrl(result.manifestUrl);
            setCurrentStep(3); // Move to success step
        } catch (err) {
            logger.error('Publish error:', err);

            // Handle specific errors
            let errorMessage = 'Failed to publish. ';

            if (err instanceof Error) {
                if (err.message.includes('not signed in') || err.message.includes('Not authenticated')) {
                    errorMessage += 'Please sign in to Farcaster first. Visit https://warpcast.com/ to create an account.';
                } else if (err.message.includes('signManifest')) {
                    errorMessage += 'SDK signing failed. Make sure you are using a Farcaster-enabled browser or wallet.';
                } else {
                    errorMessage += err.message;
                }
            } else {
                errorMessage += 'Please try again or create manifest manually at https://miniapps.farcaster.xyz/';
            }

            setError(errorMessage);
            setCurrentStep(1); // Back to form
        } finally {
            setIsLoading(false);
        }
    };

    // Reset form when modal closes
    const handleClose = () => {
        setCurrentStep(1);
        setError(null);
        setManifestUrl(null);
        setIsLoading(false);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden shadow-xl">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-200">
                    <div>
                        <h2 className="text-2xl font-funnel-display font-semibold text-black">
                            Publish to Farcaster
                        </h2>
                        <p className="text-gray-600 mt-1">
                            {currentStep === 1 && 'Enter your app details'}
                            {currentStep === 2 && 'Signing with Farcaster...'}
                            {currentStep === 3 && 'Your app is published!'}
                        </p>
                    </div>
                    <button
                        onClick={handleClose}
                        disabled={isLoading}
                        className={`p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-900 ${isLoading ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Progress Steps */}
                <div className="px-6 py-4 bg-gray-50">
                    <div className="flex items-center justify-center">
                        {[1, 2, 3].map((step, index) => (
                            <div key={step} className="flex items-center">
                                <div className={`flex items-center justify-center w-8 h-8 rounded-full border-2 ${currentStep >= step
                                    ? 'bg-black text-white border-black'
                                    : 'bg-white text-gray-400 border-gray-300'
                                    }`}>
                                    {currentStep > step ? (
                                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                        </svg>
                                    ) : (
                                        <span className="text-sm font-medium">{step}</span>
                                    )}
                                </div>
                                {index < 2 && (
                                    <div className={`w-20 h-0.5 mx-2 ${currentStep > step ? 'bg-black' : 'bg-gray-300'}`} />
                                )}
                            </div>
                        ))}
                    </div>
                    <div className="flex items-center justify-center mt-2">
                        <span className="text-xs text-gray-600">
                            {currentStep === 1 && 'Step 1: Fill Details'}
                            {currentStep === 2 && 'Step 2: Signing'}
                            {currentStep === 3 && 'Step 3: Complete'}
                        </span>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto max-h-[60vh]">
                    {/* Step 1: Form */}
                    {currentStep === 1 && (
                        <>
                            {/* SDK Status Banner */}
                            {!sdkReady && (
                                <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
                                    <div className="flex items-start gap-3">
                                        <svg className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <div className="flex-1">
                                            <p className="text-sm font-medium text-blue-900 mb-1">
                                                Publishing in Web Mode
                                            </p>
                                            <p className="text-sm text-blue-800">
                                                You&apos;re publishing without Farcaster frame signature. The manifest will still be valid and work on Farcaster. To sign with your Farcaster account, open this app in Warpcast.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}
                            {sdkReady && (
                                <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-4">
                                    <div className="flex items-start gap-3">
                                        <svg className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <div className="flex-1">
                                            <p className="text-sm font-medium text-green-900 mb-1">
                                                Farcaster Frame Mode Active
                                            </p>
                                            <p className="text-sm text-green-800">
                                                Your app will be signed with your Farcaster account and associated with your FID.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        <div className="space-y-4">
                            {/* Authentication Warning */}
                            {!isAuthenticated && (
                                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                                    <p className="text-sm text-yellow-800 font-medium">
                                        ⚠️ You need to be signed in to publish. Please authenticate first.
                                    </p>
                                </div>
                            )}

                            {error && (
                                <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                                    <p className="text-sm text-red-800">{error}</p>
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    App Name <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    placeholder="My Awesome App"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent text-black"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Icon URL <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="url"
                                    placeholder="https://example.com/icon.png"
                                    value={formData.iconUrl}
                                    onChange={(e) => setFormData({ ...formData, iconUrl: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent text-black"
                                    required
                                />
                                <p className="text-xs text-gray-500 mt-1">Publicly accessible icon image (recommended: 512x512px)</p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Home URL <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="url"
                                    placeholder="https://example.com"
                                    value={formData.homeUrl}
                                    onChange={(e) => setFormData({ ...formData, homeUrl: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent text-black"
                                    required
                                />
                                <p className="text-xs text-gray-500 mt-1">Your app&apos;s main URL</p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Description
                                </label>
                                <textarea
                                    placeholder="A brief description of your app"
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    rows={3}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent text-black"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Splash Image URL
                                </label>
                                <input
                                    type="url"
                                    placeholder="https://example.com/splash.png"
                                    value={formData.splashImageUrl}
                                    onChange={(e) => setFormData({ ...formData, splashImageUrl: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent text-black"
                                />
                                <p className="text-xs text-gray-500 mt-1">Loading screen image (optional)</p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Splash Background Color
                                </label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="color"
                                        value={formData.splashBackgroundColor}
                                        onChange={(e) => setFormData({ ...formData, splashBackgroundColor: e.target.value })}
                                        className="w-12 h-10 border border-gray-300 rounded cursor-pointer"
                                    />
                                    <input
                                        type="text"
                                        value={formData.splashBackgroundColor}
                                        onChange={(e) => setFormData({ ...formData, splashBackgroundColor: e.target.value })}
                                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent text-black"
                                        placeholder="#ffffff"
                                    />
                                </div>
                            </div>
                        </div>
                        </>
                    )}

                    {/* Step 2: Publishing */}
                    {currentStep === 2 && (
                        <div className="flex flex-col items-center justify-center py-12">
                            <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-black mb-4"></div>
                            <h3 className="text-xl font-semibold text-black mb-2">
                                {sdkReady ? 'Signing & Publishing...' : 'Publishing...'}
                            </h3>
                            <p className="text-gray-600 text-center max-w-md">
                                {sdkReady 
                                    ? 'Signing your manifest with your Farcaster account and deploying. This will associate the app with your FID.'
                                    : 'Publishing your manifest and deploying. Your app will be available on Farcaster shortly.'
                                }
                            </p>
                        </div>
                    )}

                    {/* Step 3: Success */}
                    {currentStep === 3 && (
                        <div className="flex flex-col items-center justify-center py-12">
                            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                            <h3 className="text-2xl font-semibold text-black mb-2">Published Successfully!</h3>
                            <p className="text-gray-600 text-center mb-6">
                                Your app is now published to Farcaster and discoverable by users.
                            </p>

                            {manifestUrl && (
                                <div className="w-full bg-gray-50 border border-gray-200 rounded-lg p-4">
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Manifest URL
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <code className="flex-1 text-sm text-gray-800 bg-white p-2 rounded border border-gray-300 break-all">
                                            {manifestUrl}
                                        </code>
                                        <a
                                            href={manifestUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="p-2 bg-black text-white rounded hover:bg-gray-800 transition-colors cursor-pointer"
                                            title="Open manifest"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                            </svg>
                                        </a>
                                    </div>
                                </div>
                            )}

                            <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4 w-full">
                                <p className="text-sm text-blue-800 mb-3">
                                    <strong>What&apos;s next?</strong>
                                </p>
                                <ol className="text-sm text-blue-800 space-y-2 list-decimal list-inside">
                                    <li>Your manifest is now hosted at <code className="bg-blue-100 px-1 rounded">/.well-known/farcaster.json</code></li>
                                    <li>Share your app URL on Farcaster for users to discover</li>
                                    <li>Users can add your mini app directly from your website</li>
                                </ol>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between p-6 border-t border-gray-200 bg-gray-50">
                    {currentStep === 1 && (
                        <>
                            <button
                                onClick={handleClose}
                                className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg font-medium transition-colors cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSignAndPublish}
                                disabled={isLoading || !isAuthenticated}
                                className={`px-6 py-2 bg-black text-white rounded-lg font-medium transition-colors ${
                                    isLoading || !isAuthenticated ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-800 cursor-pointer'
                                }`}
                                title={!isAuthenticated ? 'Please sign in first' : 'Publish to Farcaster'}
                            >
                                {!isAuthenticated ? 'Sign In Required' : 'Publish'}
                            </button>
                        </>
                    )}
                    {currentStep === 2 && (
                        <div className="w-full flex justify-center">
                            <span className="text-sm text-gray-600">Please wait...</span>
                        </div>
                    )}
                    {currentStep === 3 && (
                        <button
                            onClick={handleClose}
                            className="w-full px-6 py-2 bg-black text-white rounded-lg font-medium hover:bg-gray-800 transition-colors cursor-pointer"
                        >
                            Close
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
