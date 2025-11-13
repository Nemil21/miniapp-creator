'use client';
import { logger } from "../../lib/logger";


import { useState } from 'react';
import { useAuthContext } from '../contexts/AuthContext';

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
    const [manifestJson, setManifestJson] = useState('');
    
    // Get authentication from context
    const { sessionToken, isAuthenticated } = useAuthContext();

    // Validate manifest JSON
    const validateManifestJson = (jsonString: string): { valid: boolean; manifest?: unknown; error?: string } => {
        try {
            const parsed = JSON.parse(jsonString);
            
            // Check if it's an object
            if (!parsed || typeof parsed !== 'object') {
                return { valid: false, error: 'Manifest must be a valid JSON object' };
            }

            // Check for required fields based on Farcaster manifest structure
            if (!parsed.frame && !parsed.miniapp) {
                return { valid: false, error: 'Manifest must contain either "frame" or "miniapp" field' };
            }

            // Check for accountAssociation (required for Farcaster registry)
            if (!parsed.accountAssociation) {
                return { valid: false, error: 'Manifest must contain "accountAssociation" field with your Farcaster signature' };
            }

            const accountAssociation = parsed.accountAssociation;
            if (!accountAssociation.header || !accountAssociation.payload || !accountAssociation.signature) {
                return { valid: false, error: 'Account association must contain header, payload, and signature' };
            }

            // Validate frame/miniapp required fields
            const appData = parsed.frame || parsed.miniapp;
            const requiredFields = ['name', 'version', 'iconUrl', 'homeUrl'];
            
            for (const field of requiredFields) {
                if (!appData[field]) {
                    return { valid: false, error: `Missing required field: ${field}` };
                }
            }

            return { valid: true, manifest: parsed };
        } catch {
            return { valid: false, error: 'Invalid JSON format. Please check your manifest syntax.' };
        }
    };

    // Handle publish with user-provided manifest
    const handlePublish = async () => {
        logger.log('handlePublish called with:', { projectId, projectUrl });

        // Validate manifest JSON
        if (!manifestJson.trim()) {
            setError('Please paste your manifest JSON from Farcaster');
            return;
        }

        const validation = validateManifestJson(manifestJson);
        if (!validation.valid) {
            setError(validation.error || 'Invalid manifest');
            return;
        }

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
            logger.log('📤 Sending manifest to API...');

            // Check authentication
            if (!isAuthenticated || !sessionToken) {
                logger.error('❌ Not authenticated');
                throw new Error('Not authenticated. Please sign in first.');
            }

            logger.log('✅ Authentication verified');

            const response = await fetch('/api/publish', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${sessionToken}`
                },
                body: JSON.stringify({
                    projectId,
                    manifest: validation.manifest
                })
            });

            logger.log('API response status:', response.status);

            if (!response.ok) {
                let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error || errorMessage;
                    logger.error('API error response:', errorData);
                } catch {
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

            let errorMessage = 'Failed to publish. ';
            if (err instanceof Error) {
                errorMessage += err.message;
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
        setManifestJson('');
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
                            Publish to Farcaster Registry
                        </h2>
                        <p className="text-gray-600 mt-1">
                            {currentStep === 1 && 'Register your app and paste the manifest'}
                            {currentStep === 2 && 'Publishing your app...'}
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
                            {currentStep === 1 && 'Step 1: Register & Paste Manifest'}
                            {currentStep === 2 && 'Step 2: Publishing'}
                            {currentStep === 3 && 'Step 3: Complete'}
                        </span>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto max-h-[60vh]">
                    {/* Step 1: Instructions and Manifest Input */}
                    {currentStep === 1 && (
                        <div className="space-y-4">
                            {/* Authentication Warning */}
                            {!isAuthenticated && (
                                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                                    <p className="text-sm text-yellow-800 font-medium">
                                        ⚠️ You need to be signed in to publish. Please authenticate first.
                                    </p>
                                </div>
                            )}

                            {error && (
                                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                                    <p className="text-sm text-red-800">{error}</p>
                                </div>
                            )}

                            {/* Instructions Section */}
                            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                                <div className="flex items-start gap-3">
                                    <svg className="w-6 h-6 text-black mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <div className="flex-1">
                                        <h3 className="text-sm font-semibold text-black mb-2">
                                            Register Your App on Farcaster
                                        </h3>
                                        <p className="text-sm text-black mb-3">
                                            Before publishing, you need to create and sign a manifest on the: <a href="https://farcaster.xyz/~/developers/mini-apps/manifest" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:text-purple-700"> Farcaster registry</a>. This associates your app with your Farcaster account.
                                        </p>
                                        
                                        <div className="space-y-2 text-sm text-black mb-3">
                                            <p className="font-medium">Instructions:</p>
                                            <ol className="list-decimal list-inside space-y-1 pl-2">
                                                <li>Click the button below to open the Farcaster manifest creator</li>
                                                <li>Fill in all required fields for your app:
                                                    <ul className="list-disc list-inside pl-6 mt-1">
                                                        <li><strong>name</strong>: Your app&apos;s name</li>
                                                        <li><strong>iconUrl</strong>: App icon URL (512x512px recommended)</li>
                                                        <li><strong>homeUrl</strong>: Your app URL (use: <code className="bg-purple-100 px-1 rounded text-xs">{projectUrl || 'your-app-url'}</code>)</li>
                                                        <li><strong>description</strong>: Brief app description</li>
                                                        <li><strong>splashImageUrl</strong>: Splash screen image</li>
                                                        <li><strong>splashBackgroundColor</strong>: Background color (hex)</li>
                                                        <li><strong>primaryCategory</strong>: App category (e.g., games, social, etc.)</li>
                                                    </ul>
                                                </li>
                                                <li>Sign the manifest with your Farcaster account</li>
                                                <li>Copy the complete JSON manifest</li>
                                                <li>Paste it in the text area below</li>
                                            </ol>
                                        </div>

                                        <a
                                            href="https://farcaster.xyz/~/developers/mini-apps/manifest"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                            </svg>
                                            Create & Sign Manifest on Farcaster
                                        </a>
                                    </div>
                                </div>
                            </div>

                            {/* Manifest Input */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Paste Your Signed Manifest JSON <span className="text-red-500">*</span>
                                </label>
                                <textarea
                                    placeholder='{"frame": {...}, "accountAssociation": {...}}'
                                    value={manifestJson}
                                    onChange={(e) => {
                                        setManifestJson(e.target.value);
                                        setError(null); // Clear error on input
                                    }}
                                    rows={12}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent text-black font-mono text-xs"
                                    style={{ resize: 'vertical' }}
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                    Paste the complete manifest JSON you copied from the Farcaster registry site
                                </p>
                            </div>

                            {/* Your App URL Info */}
                            {projectUrl && (
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                                    <p className="text-xs text-blue-800">
                                        <strong>💡 Tip:</strong> Use this URL as your <code className="bg-blue-100 px-1 rounded">homeUrl</code>:
                                    </p>
                                    <div className="flex items-center gap-2 mt-2">
                                        <code className="flex-1 text-xs text-blue-900 bg-blue-100 p-2 rounded break-all">
                                            {projectUrl}
                                        </code>
                                        <button
                                            onClick={() => {
                                                navigator.clipboard.writeText(projectUrl);
                                            }}
                                            className="p-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                                            title="Copy URL"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Step 2: Publishing */}
                    {currentStep === 2 && (
                        <div className="flex flex-col items-center justify-center py-12">
                            <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-black mb-4"></div>
                            <h3 className="text-xl font-semibold text-black mb-2">
                                Publishing Your App...
                            </h3>
                            <p className="text-gray-600 text-center max-w-md">
                                Deploying your manifest to the app. Your app will be available on Farcaster shortly.
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
                                Your app is now registered on Farcaster and ready to use!
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

                            <div className="mt-6 bg-green-50 border border-green-200 rounded-lg p-4 w-full">
                                <p className="text-sm text-green-800 mb-3">
                                    <strong>✅ What&apos;s next?</strong>
                                </p>
                                <ul className="text-sm text-green-800 space-y-2 list-disc list-inside">
                                    <li>Your manifest is now hosted at <code className="bg-green-100 px-1 rounded">/.well-known/farcaster.json</code></li>
                                    <li>Your app is associated with your Farcaster account</li>
                                    <li>Users can discover and add your mini app on Farcaster</li>
                                    <li>Share your app URL to let users try it!</li>
                                </ul>
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
                                onClick={handlePublish}
                                disabled={isLoading || !isAuthenticated || !manifestJson.trim()}
                                className={`px-6 py-2 bg-black text-white rounded-lg font-medium transition-colors ${
                                    isLoading || !isAuthenticated || !manifestJson.trim() ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-800 cursor-pointer'
                                }`}
                                title={!isAuthenticated ? 'Please sign in first' : !manifestJson.trim() ? 'Please paste your manifest' : 'Publish to Farcaster'}
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
