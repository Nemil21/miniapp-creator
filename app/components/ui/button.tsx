import * as React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "default" | "outline" | "ghost";
    size?: "default" | "sm" | "lg";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className = "", variant = "default", size = "default", ...props }, ref) => {
        const baseStyles = "inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";
        
        const variants = {
            default: "bg-black text-white hover:bg-black/90",
            outline: "border border-black-20 bg-transparent hover:bg-black-5",
            ghost: "hover:bg-black-5",
        };
        
        const sizes = {
            default: "h-10 px-4 py-2",
            sm: "h-9 rounded-md px-3",
            lg: "h-11 rounded-md px-8",
        };
        
        const classes = `${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`;
        
        return <button className={classes} ref={ref} {...props} />;
    }
);

Button.displayName = "Button";

export { Button };










