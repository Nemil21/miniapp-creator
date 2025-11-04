"use client";

import * as React from "react";

interface DialogContextValue {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const DialogContext = React.createContext<DialogContextValue | undefined>(undefined);

interface DialogProps {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
}

export function Dialog({ open: controlledOpen, onOpenChange, children }: DialogProps) {
    const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
    const open = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen;
    const handleOpenChange = onOpenChange || setUncontrolledOpen;

    return (
        <DialogContext.Provider value={{ open, onOpenChange: handleOpenChange }}>
            {children}
        </DialogContext.Provider>
    );
}

export function DialogTrigger({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) {
    const context = React.useContext(DialogContext);
    if (!context) throw new Error("DialogTrigger must be used within Dialog");

    const handleClick = () => context.onOpenChange(true);

    if (asChild && React.isValidElement(children)) {
        return React.cloneElement(children, {
            onClick: handleClick,
        } as React.HTMLAttributes<HTMLElement>);
    }

    return <button onClick={handleClick}>{children}</button>;
}

export function DialogContent({
    children,
    className = "",
    onPointerDownOutside,
}: {
    children: React.ReactNode;
    className?: string;
    onPointerDownOutside?: () => void;
}) {
    const context = React.useContext(DialogContext);
    if (!context) throw new Error("DialogContent must be used within Dialog");

    if (!context.open) return null;

    const handleBackdropClick = () => {
        if (onPointerDownOutside) {
            onPointerDownOutside();
        }
        context.onOpenChange(false);
    };

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/50 z-50 cursor-pointer"
                onClick={handleBackdropClick}
            />
            {/* Dialog */}
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
                <div
                    className={`bg-white p-6 shadow-xl max-w-md w-full pointer-events-auto ${className}`}
                    onClick={(e) => e.stopPropagation()}
                >
                    {children}
                </div>
            </div>
        </>
    );
}

export function DialogHeader({
    children,
    className = "",
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return <div className={`mb-4 ${className}`}>{children}</div>;
}

export function DialogTitle({
    children,
    className = "",
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return <h2 className={`text-lg font-semibold ${className}`}>{children}</h2>;
}

export function DialogDescription({
    children,
    className = "",
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return <p className={`text-sm text-gray-600 ${className}`}>{children}</p>;
}


