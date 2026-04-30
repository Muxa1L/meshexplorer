import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

type AppPageShellWidth = "content" | "wide" | "full";
type AppPageShellVariant = "panel" | "none";
type AppPageShellPadding = "default" | "none";

const WIDTH_CLASSES: Record<AppPageShellWidth, string> = {
  content: "max-w-4xl",
  wide: "max-w-6xl",
  full: "max-w-none",
};

interface AppPageShellProps {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  fill?: boolean;
  padding?: AppPageShellPadding;
  variant?: AppPageShellVariant;
  width?: AppPageShellWidth;
}

export default function AppPageShell({
  children,
  className,
  contentClassName,
  fill = false,
  padding = "default",
  variant = "panel",
  width = "wide",
}: AppPageShellProps) {
  return (
    <div
      className={cn(
        "flex w-full min-h-0 flex-1 flex-col",
        padding === "default" && "px-3 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-6",
        className,
      )}
    >
      <div
        className={cn(
          "mx-auto w-full",
          WIDTH_CLASSES[width],
          fill && "flex min-h-0 flex-1 flex-col",
          variant === "panel" && [
            "rounded-[28px] border border-black/5 bg-white/80 p-4 text-gray-800 shadow-sm backdrop-blur",
            "dark:border-white/10 dark:bg-neutral-900/80 dark:text-gray-200",
            "sm:p-5 lg:p-6",
          ],
          contentClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}