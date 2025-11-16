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
    const [accountAssociationJson, setAccountAssociationJson] = useState('');
    const [verificationSuccess, setVerificationSuccess] = useState<string | null>(null);
    
    // Get authentication from context
    const { sessionToken, isAuthenticated } = useAuthContext();

    // Extract domain from projectUrl (without https:// and without trailing /)
    const getDomain = () => {
        if (!projectUrl) return '';
        return projectUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    };

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

    // Handle updating account association
    const handleUpdateAccountAssociation = async () => {
        if (!accountAssociationJson.trim()) {
            setError('Please paste the accountAssociation JSON');
            return;
        }

        setIsLoading(true);
        setError(null);
        setVerificationSuccess(null);

        try {
            let parsed = JSON.parse(accountAssociationJson);
            
            // Handle both formats: with or without outer accountAssociation wrapper
            if (parsed.accountAssociation) {
                parsed = parsed.accountAssociation;
            }
            
            // Validate accountAssociation structure
            if (!parsed.header || !parsed.payload || !parsed.signature) {
                throw new Error('Invalid accountAssociation format. Must contain header, payload, and signature.');
            }

            if (!projectId) {
                throw new Error('Project ID is missing');
            }

            // Update the manifest with new account association
            const currentManifest = JSON.parse(manifestJson);
            currentManifest.accountAssociation = parsed;

            const response = await fetch('/api/publish', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${sessionToken}`
                },
                body: JSON.stringify({
                    projectId,
                    manifest: currentManifest
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to update account association');
            }

            await response.json();
            setVerificationSuccess('✅ Account association updated successfully! Your app is now linked to your Farcaster account.');
            setAccountAssociationJson('');
        } catch (err) {
            logger.error('Account association update error:', err);
            const errorMessage = err instanceof Error ? err.message : 'Failed to update account association';
            setError(errorMessage);
        } finally {
            setIsLoading(false);
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
        setAccountAssociationJson('');
        setVerificationSuccess(null);
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
                            {currentStep === 4 && 'Verify and troubleshoot your app'}
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
                        {[1, 2, 3, 4].map((step, index) => (
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
                                {index < 3 && (
                                    <div className={`w-16 h-0.5 mx-2 ${currentStep > step ? 'bg-black' : 'bg-gray-300'}`} />
                                )}
                            </div>
                        ))}
                    </div>
                    <div className="flex items-center justify-center mt-2">
                        <span className="text-xs text-gray-600">
                            {currentStep === 1 && 'Step 1: Register & Paste Manifest'}
                            {currentStep === 2 && 'Step 2: Publishing'}
                            {currentStep === 3 && 'Step 3: Complete'}
                            {currentStep === 4 && 'Step 4: Verification & Troubleshooting'}
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
                                                 <li>Click on + New button</li>
                                                <li>Fill in all required fields for your app:
                                                    <ul className="list-disc list-inside pl-6 mt-1">
                                                        <li><strong>name</strong>: Your app&apos;s name</li>
                                                        <li><strong>iconUrl</strong>: App icon URL (512x512px recommended)</li>
                                                        <li><strong>homeUrl</strong>: Your app URL (use: <code className="bg-purple-100 px-1 rounded text-xs">{projectUrl || 'your-app-url'}</code>)</li>
                                                        <li><strong>subtitle</strong>: App subtitle</li>
                                                        <li><strong>description</strong>: Brief app description</li>
                                                        <li><strong>splashImageUrl</strong>: Splash screen image URL</li>
                                                        <li><strong>splashBackgroundColor</strong>: Background color (hex-code) example: #ffffff for white</li>
                                                        <li><strong>primaryCategory</strong>: App category (e.g., games, social, etc.)</li>
                                                    </ul>
                                                </li>
                                                <li>Sign the manifest with your Farcaster account</li>
                                                <li>Copy the complete JSON manifest showing at the bottom of the farcaster manifest page</li>
                                                <li>Paste it in the text area below</li>
                                                <li>Click the Publish button to publish your changes</li>
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

                    {/* Step 4: Verification & Troubleshooting */}
                    {currentStep === 4 && (
                        <div className="space-y-4">
                            <div className="flex flex-col items-center justify-center py-4">
                                <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mb-4">
                                    <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                </div>
                                <h3 className="text-2xl font-semibold text-black mb-2">Verification & Troubleshooting</h3>
                                <p className="text-gray-600 text-center mb-6">
                                    Verify your app registration and fix any issues
                                </p>
                            </div>

                            {error && (
                                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                                    <p className="text-sm text-red-800">{error}</p>
                                </div>
                            )}

                            {verificationSuccess && (
                                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                                    <p className="text-sm text-green-800">{verificationSuccess}</p>
                                </div>
                            )}

                            {/* Verification Instructions */}
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                <div className="flex items-start gap-3">
                                    <svg className="w-6 h-6 text-blue-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <div className="flex-1">
                                        <h3 className="text-sm font-semibold text-blue-900 mb-2">
                                            Verify Your App Registration
                                        </h3>
                                        <p className="text-sm text-blue-900 mb-3">
                                            Check if your app is properly associated with your Farcaster account by visiting the{' '}
                                            <a 
                                                href="https://farcaster.xyz/~/developers/mini-apps/manifest" 
                                                target="_blank" 
                                                rel="noopener noreferrer"
                                                className="text-blue-600 hover:text-blue-700 underline font-medium"
                                            >
                                                Farcaster manifest page
                                            </a>.
                                        </p>
                                        
                                        <div className="space-y-2 text-sm text-blue-900 mb-3">
                                            <p className="font-medium">Steps to verify:</p>
                                            <ol className="list-decimal list-inside space-y-1 pl-2">
                                                <li>Go to the <a href="https://farcaster.xyz/~/developers/mini-apps/manifest" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700 underline">Farcaster manifest page</a></li>
                                                <li>Enter your domain in the verification field:
                                                    <div className="mt-2 bg-blue-100 p-2 rounded border border-blue-300">
                                                        <code className="text-sm text-blue-900 font-mono break-all">
                                                            {getDomain() || 'your-domain.com'}
                                                        </code>
                                                    </div>
                                                </li>
                                                <li className="mt-2">Check the result:
                                                    <ul className="list-disc list-inside pl-6 mt-1 space-y-1">
                                                        <li><strong>If you see:</strong> &quot;Associated with your account&quot; - ✅ Everything is working! You&apos;re all set.</li>
                                                        <li><strong>If you see:</strong> &quot;Account association not found&quot; - Follow the troubleshooting steps below.</li>
                                                    </ul>
                                                </li>
                                            </ol>
                                        </div>

                                        <a
                                            href="https://farcaster.xyz/~/developers/mini-apps/manifest"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                            </svg>
                                            Verify on Farcaster
                                        </a>
                                    </div>
                                </div>
                            </div>

                            {/* Troubleshooting Section */}
                            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                                <div className="flex items-start gap-3">
                                    <svg className="w-6 h-6 text-orange-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                    <div className="flex-1">
                                        <h3 className="text-sm font-semibold text-orange-900 mb-2">
                                            Troubleshooting: Account Association Not Found
                                        </h3>
                                        <p className="text-sm text-orange-900 mb-3">
                                            If the verification shows &quot;Account association not found&quot;, you need to update your account association. This happens occasionally and is easy to fix.
                                        </p>
                                        
                                        <div className="space-y-2 text-sm text-orange-900 mb-3">
                                            <p className="font-medium">How to fix:</p>
                                            <ol className="list-decimal list-inside space-y-1 pl-2">
                                                <li>On the Farcaster manifest page, Click on generate account association button.</li>
                                                <li> Scan and verify, after which you&apos;ll see an <code className="bg-orange-100 px-1 rounded">&quot;accountAssociation&quot;</code> object.</li>
                                                <li>Copy the entire <code className="bg-orange-100 px-1 rounded">accountAssociation</code> JSON (including the curly braces)</li>
                                                <li>Paste it in the text box below</li>
                                                <li>Click &quot;Update Account Association&quot;</li>
                                            </ol>
                                        </div>

                                        <div className="mt-3">
                                            <label className="block text-sm font-medium text-orange-900 mb-2">
                                                Paste Account Association JSON <span className="text-red-500">*</span>
                                            </label>
                                            <textarea
                                                placeholder='{"header":"...","payload":"...","signature":"..."}'
                                                value={accountAssociationJson}
                                                onChange={(e) => {
                                                    setAccountAssociationJson(e.target.value);
                                                    setError(null);
                                                    setVerificationSuccess(null);
                                                }}
                                                rows={6}
                                                className="w-full px-3 py-2 border border-orange-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent text-black font-mono text-xs bg-white"
                                                style={{ resize: 'vertical' }}
                                            />
                                            <p className="text-xs text-orange-700 mt-1">
                                                Copy and paste just the accountAssociation object from the Farcaster manifest page
                                            </p>
                                            
                                            <button
                                                onClick={handleUpdateAccountAssociation}
                                                disabled={isLoading || !accountAssociationJson.trim()}
                                                className={`mt-3 px-4 py-2 bg-orange-600 text-white rounded-lg font-medium transition-colors ${
                                                    isLoading || !accountAssociationJson.trim() ? 'opacity-50 cursor-not-allowed' : 'hover:bg-orange-700 cursor-pointer'
                                                }`}
                                            >
                                                {isLoading ? 'Updating...' : 'Update Account Association'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Info Note */}
                            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                                <p className="text-xs text-gray-600">
                                    <strong>ℹ️ Note:</strong> Most users won&apos;t need to use the troubleshooting section. If you see &quot;Associated with your account&quot; when you verify, everything is working perfectly and you can close this dialog!
                                </p>
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
                        <>
                            <button
                                onClick={() => setCurrentStep(4)}
                                className="px-6 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition-colors cursor-pointer"
                            >
                                Verify & Troubleshoot
                            </button>
                            <button
                                onClick={handleClose}
                                className="px-6 py-2 bg-black text-white rounded-lg font-medium hover:bg-gray-800 transition-colors cursor-pointer"
                            >
                                Close
                            </button>
                        </>
                    )}
                    {currentStep === 4 && (
                        <>
                            <button
                                onClick={() => setCurrentStep(3)}
                                className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg font-medium transition-colors cursor-pointer"
                            >
                                Back
                            </button>
                            <button
                                onClick={handleClose}
                                className="px-6 py-2 bg-black text-white rounded-lg font-medium hover:bg-gray-800 transition-colors cursor-pointer"
                            >
                                Close
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
