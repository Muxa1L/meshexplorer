"use client";
import Link from "next/link";
import { Cog6ToothIcon, InformationCircleIcon, ChevronDownIcon, SunIcon, MoonIcon, ComputerDesktopIcon, EllipsisHorizontalIcon } from "@heroicons/react/24/outline";
import { useConfig } from "./ConfigContext";
import React, { useState, useEffect, useRef, useCallback } from "react";
import InfoModal from "./InfoModal";
import { useLocale } from "./LocaleProvider";
import { getAppName } from "@/lib/api";
import { useTheme } from "./ThemeProvider";

interface HeaderProps {
  configButtonRef?: React.Ref<HTMLButtonElement>;
}

interface NavItem {
  href: string;
  label: string;
  icon?: React.ReactNode;
  isVisible?: boolean;
}

const THEME_CYCLE = ["system", "light", "dark"] as const;

const THEME_ICON = {
  light: SunIcon,
  dark: MoonIcon,
  system: ComputerDesktopIcon,
} as const;

const THEME_LABEL = {
  light: "Light",
  dark: "Dark",
  system: "System",
} as const;

export default function Header({ configButtonRef }: HeaderProps) {
  const { openConfig, configButtonRef: contextButtonRef } = useConfig();
  const { theme, setTheme } = useTheme();
  const { locale, setLocale, t } = useLocale();
  const [infoModalOpen, setInfoModalOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [visibleItems, setVisibleItems] = useState<NavItem[]>([]);
  const [hiddenItems, setHiddenItems] = useState<NavItem[]>([]);
  const [showLocaleSwitch, setShowLocaleSwitch] = useState(true);
  const [showThemeButton, setShowThemeButton] = useState(true);
  // const [showInfoButton, setShowInfoButton] = useState(true);
  const [showSettingsButton, setShowSettingsButton] = useState(true);
  
  const headerRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const itemsRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const actionsDropdownRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  // Measure available space and determine which items can fit
  const measureAndLayout = useCallback(() => {
    // Define all navigation items
    const allNavItems: NavItem[] = [
      { href: "/join", label: t("header.howToJoin") },
      // { href: "/messages", label: t("header.messages") }, // TEMPORARILY_DISABLED
      { href: "/map", label: t("header.map") },
      { href: "/packets", label: t("header.packets") },
      { href: "/stats", label: t("header.stats") },
      { href: "/packet-count", label: t("header.packetStats") },
      { href: "/search", label: t("header.search") },
      // { href: "/api-docs", label: t("header.apiDocs") },
      // { href: "/wardrive", label: "Wardrive" },
      // { href: "/coverage", label: "Coverage" },
    ];
    if (!navRef.current || !itemsRef.current) return;

    const headerWidth = headerRef.current?.offsetWidth ?? window.innerWidth;

    setShowLocaleSwitch(headerWidth >= 900);
    setShowThemeButton(headerWidth >= 780);
    // setShowInfoButton(headerWidth >= 730);
    setShowSettingsButton(headerWidth >= 680);

    const navWidth = navRef.current.offsetWidth;
    const rightSectionWidth = actionsRef.current?.offsetWidth ?? 200;
    const availableWidth = navWidth - rightSectionWidth - 48 - 120; // 48px for padding

    // Create temporary elements to measure item widths
    const tempContainer = document.createElement('div');
    tempContainer.style.position = 'absolute';
    tempContainer.style.visibility = 'hidden';
    tempContainer.style.whiteSpace = 'nowrap';
    tempContainer.className = 'flex gap-6 items-center';
    document.body.appendChild(tempContainer);

    // Measure all items first to get their widths
    const itemWidths: number[] = [];
    for (const item of allNavItems) {
      const tempItem = document.createElement('a');
      tempItem.href = item.href;
      tempItem.textContent = item.label;
      tempItem.className = 'text-gray-800 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors';
      tempContainer.appendChild(tempItem);
      itemWidths.push(tempItem.offsetWidth);
    }

    document.body.removeChild(tempContainer);

    // Find the cutoff point while preserving order
    let currentWidth = 0;
    let cutoffIndex = allNavItems.length;

    for (let i = 0; i < allNavItems.length; i++) {
      const itemWidth = itemWidths[i];
      const gapWidth = i > 0 ? 24 : 0; // 24px gap between items
      
      if (currentWidth + itemWidth + gapWidth <= availableWidth) {
        currentWidth += itemWidth + gapWidth;
      } else {
        cutoffIndex = i;
        break;
      }
    }

    // Split items at the cutoff point to preserve order
    const visible = allNavItems.slice(0, cutoffIndex);
    const hidden = allNavItems.slice(cutoffIndex);

    setVisibleItems(visible);
    setHiddenItems(hidden);
  }, [t]);

  const themeLabel = THEME_LABEL[theme] === "Light"
    ? t("header.themeLight")
    : THEME_LABEL[theme] === "Dark"
      ? t("header.themeDark")
      : t("header.themeSystem");

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      measureAndLayout();
    };

    window.addEventListener('resize', handleResize);
    measureAndLayout();

    return () => window.removeEventListener('resize', handleResize);
  }, [measureAndLayout]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
      if (actionsDropdownRef.current && !actionsDropdownRef.current.contains(event.target as Node)) {
        setActionsMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const cycleTheme = () => {
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length];
    setTheme(next);
  };

  const hasHiddenActions = !showLocaleSwitch || !showThemeButton || !showSettingsButton;

  return (
    <>
      <header ref={headerRef} className="sticky top-0 z-[1100] flex w-full shrink-0 items-center justify-between bg-white px-6 py-3 text-gray-800 shadow dark:bg-neutral-900 dark:text-gray-100">
        <nav ref={navRef} className="flex gap-6 items-center flex-1">
          <Link href="/" className="font-bold text-lg flex-shrink-0">{getAppName()}</Link>
          <div ref={itemsRef} className="flex gap-6 items-center">
            {visibleItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-gray-800 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors whitespace-nowrap"
              >
                {item.label}
              </Link>
            ))}
            {hiddenItems.length > 0 && (
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex items-center gap-1 text-gray-800 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                  aria-label={t("header.moreNavigationOptions")}
                >
                  {t("header.more")}
                  <ChevronDownIcon className="h-4 w-4" />
                </button>
                {dropdownOpen && (
                  <div className="absolute top-full left-0 mt-2 w-48 bg-white dark:bg-neutral-800 rounded-md shadow-lg border border-gray-200 dark:border-neutral-700 z-30">
                    {hiddenItems.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="block px-4 py-2 text-sm text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors"
                        onClick={() => setDropdownOpen(false)}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </nav>
        <div ref={actionsRef} className="flex items-center gap-1.5 flex-shrink-0 sm:gap-2">
          {showLocaleSwitch && (
            <div className="flex items-center gap-1 rounded border border-gray-200 p-1 dark:border-neutral-700">
              <button
                onClick={() => setLocale("en")}
                className={`px-1.5 py-1 text-xs rounded sm:px-2 ${locale === "en" ? "bg-blue-600 text-white" : "text-gray-700 dark:text-gray-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
                aria-label={t("common.english")}
                title={t("common.english")}
              >
                EN
              </button>
              <button
                onClick={() => setLocale("ru")}
                className={`px-1.5 py-1 text-xs rounded sm:px-2 ${locale === "ru" ? "bg-blue-600 text-white" : "text-gray-700 dark:text-gray-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
                aria-label={t("common.russian")}
                title={t("common.russian")}
              >
                RU
              </button>
            </div>
          )}
          {showThemeButton && (
            <button
              onClick={cycleTheme}
              className="flex items-center gap-2 px-3 py-2 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
              aria-label={t("header.switchTheme", { theme: themeLabel })}
              title={t("header.themeTitle", { theme: themeLabel })}
            >
              {(() => { const Icon = THEME_ICON[theme]; return <Icon className="h-6 w-6" />; })()}
              <span className="hidden sm:inline">{themeLabel}</span>
            </button>
          )}
          {showSettingsButton && (
            <button
              ref={configButtonRef || contextButtonRef}
              onClick={openConfig}
              className="flex items-center gap-2 px-3 py-2 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
              aria-label={t("header.openSettings")}
            >
              <Cog6ToothIcon className="h-6 w-6" />
              <span className="hidden sm:inline">{t("common.settings")}</span>
            </button>
          )}
          {hasHiddenActions && (
            <div className="relative" ref={actionsDropdownRef}>
              <button
                onClick={() => setActionsMenuOpen(!actionsMenuOpen)}
                className="flex items-center gap-1 rounded px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                aria-label={t("header.moreNavigationOptions")}
              >
                <EllipsisHorizontalIcon className="h-6 w-6" />
              </button>
              {actionsMenuOpen && (
                <div className="absolute right-0 top-full z-30 mt-2 min-w-52 rounded-md border border-gray-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
                  {!showLocaleSwitch && (
                    <div className="border-b border-gray-200 p-2 dark:border-neutral-700">
                      <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        {t("header.language")}
                      </div>
                      <div className="flex items-center gap-2 px-2 pb-1">
                        <button
                          onClick={() => {
                            setLocale("en");
                            setActionsMenuOpen(false);
                          }}
                          className={`px-2 py-1 text-xs rounded ${locale === "en" ? "bg-blue-600 text-white" : "text-gray-700 dark:text-gray-300 hover:bg-neutral-100 dark:hover:bg-neutral-700"}`}
                        >
                          EN
                        </button>
                        <button
                          onClick={() => {
                            setLocale("ru");
                            setActionsMenuOpen(false);
                          }}
                          className={`px-2 py-1 text-xs rounded ${locale === "ru" ? "bg-blue-600 text-white" : "text-gray-700 dark:text-gray-300 hover:bg-neutral-100 dark:hover:bg-neutral-700"}`}
                        >
                          RU
                        </button>
                      </div>
                    </div>
                  )}
                  {!showThemeButton && (
                    <button
                      onClick={() => {
                        cycleTheme();
                        setActionsMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-3 px-4 py-2 text-sm text-gray-800 transition-colors hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-neutral-700"
                    >
                      {(() => { const Icon = THEME_ICON[theme]; return <Icon className="h-5 w-5" />; })()}
                      <span>{t("header.themeTitle", { theme: themeLabel })}</span>
                    </button>
                  )}
                  {!showSettingsButton && (
                    <button
                      onClick={() => {
                        openConfig();
                        setActionsMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-3 px-4 py-2 text-sm text-gray-800 transition-colors hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-neutral-700"
                    >
                      <Cog6ToothIcon className="h-5 w-5" />
                      <span>{t("common.settings")}</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </header>
      <InfoModal isOpen={infoModalOpen} onClose={() => setInfoModalOpen(false)} />
    </>
  );
} 