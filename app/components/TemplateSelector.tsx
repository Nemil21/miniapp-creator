'use client';

import { useState } from 'react';
import Image from 'next/image';
import { FarcasterMigrationModal } from './FarcasterMigrationModal';

interface TemplateOption {
  id: string;
  title: string;
  description: string;
  logo: string;
  appType: 'farcaster' | 'web3';
}

interface TemplateSelectorProps {
  selectedAppType: 'farcaster' | 'web3';
  onSelectTemplate: (appType: 'farcaster' | 'web3') => void;
}

const templateOptions: TemplateOption[] = [
  {
    id: "farcaster-miniapp",
    title: "Farcaster Miniapp",
    description: "Create and Launch an app that runs inside Farcaster.",
    logo: "/farcaster.svg",
    appType: 'farcaster',
  },
  {
    id: "base-webapp",
    title: "Web3 App",
    description: "Create a web app deployed on Base mainnet.",
    logo: "/base-logo.svg",
    appType: 'web3',
  },
];

export function TemplateSelector({ selectedAppType, onSelectTemplate }: TemplateSelectorProps) {
  const [showMigrationModal, setShowMigrationModal] = useState(false);

  const handleTemplateClick = (template: TemplateOption) => {
    if (template.appType === 'farcaster') {
      setShowMigrationModal(true);
    } else {
      onSelectTemplate(template.appType);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <FarcasterMigrationModal
        isOpen={showMigrationModal}
        onClose={() => setShowMigrationModal(false)}
      />
      
      <div className="text-center mb-8">
        <div className="mb-4 flex justify-center">
          <div className="w-16 h-16 bg-black rounded-2xl flex items-center justify-center">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M20 8V32M8 20H32" stroke="white" strokeWidth="3" strokeLinecap="round"/>
            </svg>
          </div>
        </div>
        <h2 className="text-2xl font-bold text-black mb-2">Choose Your Build</h2>
        <p className="text-sm text-black-60">
          Select a app template to start building your web3 app.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {templateOptions.map((template) => {
          const isSelected = selectedAppType === template.appType;
          return (
            <button
              key={template.id}
              onClick={() => handleTemplateClick(template)}
              className={`group relative bg-white rounded-2xl p-6 text-left transition-all duration-200 flex flex-col gap-3 ${
                isSelected 
                  ? 'border-2 border-black shadow-lg ring-2 ring-black ring-opacity-10' 
                  : 'border border-gray-200 hover:border-black-30 hover:shadow-lg'
              }`}
            >
              {/* Icon and Title Row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all bg-gray-200`}>
                    <Image
                      src={template.logo}
                      alt={template.title}
                      width={24}
                      height={24}
                      className=""
                    />
                  </div>
                  <h3 className="text-lg font-semibold text-black">{template.title}</h3>
                </div>
                {isSelected ? (
                  <svg 
                    width="20" 
                    height="20" 
                    viewBox="0 0 20 20" 
                    fill="none" 
                    className="text-black"
                  >
                    <path 
                      d="M16.667 5L7.5 14.167L3.333 10" 
                      stroke="currentColor" 
                      strokeWidth="2.5" 
                      strokeLinecap="round" 
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <svg 
                    width="20" 
                    height="20" 
                    viewBox="0 0 20 20" 
                    fill="none" 
                    className="text-gray-400 group-hover:text-black transition-colors"
                  >
                    <path 
                      d="M7.5 5L12.5 10L7.5 15" 
                      stroke="currentColor" 
                      strokeWidth="2" 
                      strokeLinecap="round" 
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>

              {/* Description */}
              <p className="text-sm text-black-60 leading-relaxed">
                {template.description}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

