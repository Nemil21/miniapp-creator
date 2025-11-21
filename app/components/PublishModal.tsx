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
    
    // Form fields for manifest
    const [appName, setAppName] = useState('');
    const [iconUrl, setIconUrl] = useState('');
    const [homeUrl, setHomeUrl] = useState(projectUrl || '');
    const [subtitle, setSubtitle] = useState('');
    const [description, setDescription] = useState('');
    const [splashImageUrl, setSplashImageUrl] = useState('');
    const [splashBackgroundColor, setSplashBackgroundColor] = useState('#ffffff');
    const [primaryCategory, setPrimaryCategory] = useState('');
    
    // Get authentication from context
    const { sessionToken, isAuthenticated } = useAuthContext();

    // Extract domain from projectUrl (without https:// and without trailing /)
    const getDomain = () => {
        if (!projectUrl) return '';
        return projectUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    };

    // Validate manifest JSON
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

    // Handle publish with form data
    const handlePublish = async () => {
        logger.log('handlePublish called with:', { projectId, projectUrl });

        // Validate required form fields
        if (!appName.trim()) {
            setError('App name is required');
            return;
        }
        if (!iconUrl.trim()) {
            setError('Icon URL is required');
            return;
        }
        if (!homeUrl.trim()) {
            setError('Home URL is required');
            return;
        }
        if (!subtitle.trim()) {
            setError('Subtitle is required');
            return;
        }
        if (!description.trim()) {
            setError('Description is required');
            return;
        }
        if (!splashImageUrl.trim()) {
            setError('Splash Image URL is required');
            return;
        }
        if (!splashBackgroundColor.trim()) {
            setError('Splash Background Color is required');
            return;
        }
        if (!primaryCategory.trim()) {
            setError('Primary Category is required');
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
            logger.log('📤 Constructing and sending manifest to API...');

            // Check authentication
            if (!isAuthenticated || !sessionToken) {
                logger.error('❌ Not authenticated');
                throw new Error('Not authenticated. Please sign in first.');
            }

            logger.log('✅ Authentication verified');

            // Construct manifest from form fields
            const manifest: Record<string, unknown> = {
                accountAssociation: null, // Will be added later in step 4
                frame: {
                    version: '1',
                    name: appName.trim(),
                    iconUrl: iconUrl.trim(),
                    homeUrl: homeUrl.trim(),
                    imageUrl: iconUrl.trim(), // Use iconUrl as imageUrl
                    buttonTitle: 'Launch',
                    subtitle: subtitle.trim(),
                    description: description.trim(),
                    splashImageUrl: splashImageUrl.trim(),
                    splashBackgroundColor: splashBackgroundColor.trim(),
                    primaryCategory: primaryCategory.trim(),
                }
            };

            // Store manifest JSON for later use in account association step
            setManifestJson(JSON.stringify(manifest, null, 2));

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
        setAppName('');
        setIconUrl('');
        setHomeUrl(projectUrl || '');
        setSubtitle('');
        setDescription('');
        setSplashImageUrl('');
        setSplashBackgroundColor('#ffffff');
        setPrimaryCategory('');
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
                            {currentStep === 1 && 'Fill in your app details'}
                            {currentStep === 2 && 'Publishing your app...'}
                            {currentStep === 3 && 'Your app is published!'}
                            {currentStep === 4 && 'Add account association'}
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
                            {currentStep === 1 && 'Step 1: App Details'}
                            {currentStep === 2 && 'Step 2: Publishing'}
                            {currentStep === 3 && 'Step 3: Complete'}
                            {currentStep === 4 && 'Step 4: Account Association'}
                        </span>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto max-h-[60vh]">
                    {/* Step 1: App Details Form */}
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

                            {/* Info Section */}
                            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                                <div className="flex items-start gap-3">
                                    <svg className="w-6 h-6 text-purple-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <div className="flex-1">
                                        <h3 className="text-sm font-semibold text-purple-900 mb-2">
                                            Fill in Your App Details
                                        </h3>
                                        <p className="text-sm text-purple-900">
                                            Enter your app information below. We&apos;ll create the farcaster.json manifest for you. After publishing, you&apos;ll need to add the account association from Farcaster to complete the setup.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Required Fields */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-semibold text-gray-900">Required Fields</h3>
                                
                                {/* App Name */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        App Name <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="My Awesome App"
                                        value={appName}
                                        onChange={(e) => {
                                            setAppName(e.target.value);
                                            setError(null);
                                        }}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent text-black"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">The display name of your app</p>
                                </div>

                                {/* Icon URL */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Icon URL <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="url"
                                        placeholder="https://example.com/icon.png"
                                        value={iconUrl}
                                        onChange={(e) => {
                                            setIconUrl(e.target.value);
                                            setError(null);
                                        }}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent text-black"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">App icon URL (512x512px recommended)</p>
                                </div>

                                {/* Home URL */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Home URL <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="url"
                                        placeholder={projectUrl || "https://your-app.com"}
                                        value={homeUrl}
                                        onChange={(e) => {
                                            setHomeUrl(e.target.value);
                                            setError(null);
                                        }}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent text-black"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        Your app&apos;s URL {projectUrl && `(default: ${projectUrl})`}
                                    </p>
                                </div>
                            </div>

                            {/* Additional Required Fields */}
                            <div className="space-y-4 pt-4 border-t border-gray-200">
                                
                                {/* Subtitle */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Subtitle <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="A brief tagline for your app"
                                        value={subtitle}
                                        onChange={(e) => setSubtitle(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent text-black"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">Short tagline or subtitle</p>
                                </div>

                                {/* Description */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Description <span className="text-red-500">*</span>
                                    </label>
                                    <textarea
                                        placeholder="Describe what your app does..."
                                        value={description}
                                        onChange={(e) => setDescription(e.target.value)}
                                        rows={3}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent text-black"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">Brief description of your app</p>
                                </div>

                                {/* Splash Image URL */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Splash Image URL <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="url"
                                        placeholder="https://example.com/splash.png"
                                        value={splashImageUrl}
                                        onChange={(e) => setSplashImageUrl(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent text-black"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">Splash screen image</p>
                                </div>

                                {/* Splash Background Color */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Splash Background Color <span className="text-red-500">*</span>
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            type="color"
                                            value={splashBackgroundColor}
                                            onChange={(e) => setSplashBackgroundColor(e.target.value)}
                                            className="h-10 w-16 border border-gray-300 rounded-lg cursor-pointer"
                                        />
                                        <input
                                            type="text"
                                            placeholder="#ffffff"
                                            value={splashBackgroundColor}
                                            onChange={(e) => setSplashBackgroundColor(e.target.value)}
                                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent text-black"
                                        />
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">Background color for splash screen (hex code)</p>
                                </div>

                                {/* Primary Category */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Primary Category <span className="text-red-500">*</span>
                                    </label>
                                    <select
                                        value={primaryCategory}
                                        onChange={(e) => setPrimaryCategory(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent text-black"
                                    >
                                        <option value="">Select a category...</option>
                                        <option value="games">Games</option>
                                        <option value="social">Social</option>
                                        <option value="defi">DeFi</option>
                                        <option value="nft">NFT</option>
                                        <option value="utility">Utility</option>
                                        <option value="entertainment">Entertainment</option>
                                        <option value="productivity">Productivity</option>
                                        <option value="other">Other</option>
                                    </select>
                                    <p className="text-xs text-gray-500 mt-1">App category for discovery</p>
                                </div>
                            </div>
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

                            <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4 w-full">
                                <p className="text-sm text-blue-800 mb-3">
                                    <strong>📝 Important: Add Account Association</strong>
                                </p>
                                <p className="text-sm text-blue-800 mb-3">
                                    Your manifest has been deployed, but you need to add the account association to link it with your Farcaster account. This is required for your app to be discoverable on Farcaster.
                                </p>
                                <button
                                    onClick={() => setCurrentStep(4)}
                                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                                >
                                    Add Account Association →
                                </button>
                            </div>

                            <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg p-4 w-full">
                                <p className="text-sm text-gray-700 mb-2">
                                    <strong>✅ What&apos;s been done:</strong>
                                </p>
                                <ul className="text-sm text-gray-700 space-y-1 list-disc list-inside">
                                    <li>Manifest created with your app details</li>
                                    <li>Deployed to <code className="bg-gray-200 px-1 rounded">/.well-known/farcaster.json</code></li>
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
                                <h3 className="text-2xl font-semibold text-black mb-2">Add Account Association</h3>
                                <p className="text-gray-600 text-center mb-6">
                                    Generate and paste your Farcaster account association to complete setup
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
                            {/* Domain Display for Verification */}
                            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Your Domain
                                </label>
                                <div className="flex items-center gap-2">
                                    <code className="flex-1 text-sm text-gray-800 bg-white p-2 rounded border border-gray-300 break-all">
                                        {getDomain() || 'your-domain.com'}
                                    </code>
                                    <button
                                        onClick={() => {
                                            navigator.clipboard.writeText(getDomain());
                                        }}
                                        className="p-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
                                        title="Copy domain"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                                        </svg>
                                    </button>
                                </div>
                                <p className="text-xs text-gray-500 mt-1">
                                    Use this domain to verify your app on Farcaster
                                </p>
                            </div>

                            {/* Account Association Instructions */}
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                <div className="flex items-start gap-3">
                                    <svg className="w-6 h-6 text-blue-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <div className="flex-1">
                                        <h3 className="text-sm font-semibold text-blue-900 mb-2">
                                            Generate Your Account Association
                                        </h3>
                                        <ol className="list-decimal list-inside space-y-1 pl-2 text-sm text-blue-900 mb-3">
                                            <li>Click the button below to open the Farcaster manifest page</li>
                                            <li>Click <strong>Generate account association</strong> and sign</li>
                                            <li>Copy the entire <code className="bg-blue-100 px-1 rounded">accountAssociation</code> JSON object</li>
                                            <li>Paste it below and click <strong>Update Account Association</strong></li>
                                        </ol>

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

                                        <div className="mt-4">
                                            <label className="block text-sm font-medium text-blue-900 mb-2">
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
                                                className="w-full px-3 py-2 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black font-mono text-xs bg-white"
                                                style={{ resize: 'vertical' }}
                                            />
                                            <p className="text-xs text-blue-700 mt-1">
                                                Copy and paste just the accountAssociation object from the Farcaster manifest page
                                            </p>
                                            
                                            <button
                                                onClick={handleUpdateAccountAssociation}
                                                disabled={isLoading || !accountAssociationJson.trim()}
                                                className={`mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium transition-colors ${
                                                    isLoading || !accountAssociationJson.trim() ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-700 cursor-pointer'
                                                }`}
                                            >
                                                {isLoading ? 'Updating...' : 'Update Account Association'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
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
                                disabled={
                                    isLoading ||
                                    !isAuthenticated ||
                                    !appName.trim() ||
                                    !iconUrl.trim() ||
                                    !homeUrl.trim() ||
                                    !subtitle.trim() ||
                                    !description.trim() ||
                                    !splashImageUrl.trim() ||
                                    !splashBackgroundColor.trim() ||
                                    !primaryCategory.trim()
                                }
                                className={`px-6 py-2 bg-black text-white rounded-lg font-medium transition-colors ${
                                    isLoading ||
                                    !isAuthenticated ||
                                    !appName.trim() ||
                                    !iconUrl.trim() ||
                                    !homeUrl.trim() ||
                                    !subtitle.trim() ||
                                    !description.trim() ||
                                    !splashImageUrl.trim() ||
                                    !splashBackgroundColor.trim() ||
                                    !primaryCategory.trim()
                                        ? 'opacity-50 cursor-not-allowed'
                                        : 'hover:bg-gray-800 cursor-pointer'
                                }`}
                                title={
                                    !isAuthenticated
                                        ? 'Please sign in first'
                                        : (!appName.trim() ||
                                           !iconUrl.trim() ||
                                           !homeUrl.trim() ||
                                           !subtitle.trim() ||
                                           !description.trim() ||
                                           !splashImageUrl.trim() ||
                                           !splashBackgroundColor.trim() ||
                                           !primaryCategory.trim())
                                            ? 'Please fill in all required fields'
                                            : 'Publish to Farcaster'
                                }
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
                                Add Account Association
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
