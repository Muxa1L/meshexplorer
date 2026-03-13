"use client";
import { useConfig } from "./ConfigContext";
import { useLocale } from "./LocaleProvider";
import { getLocalizedRegionFriendlyNames } from "@/lib/regions";

interface RegionSelectorProps {
  onRegionSelected?: () => void;
  className?: string;
}

export default function RegionSelector({ onRegionSelected, className = "" }: RegionSelectorProps) {
  const { config, setConfig } = useConfig();
  const { locale, t } = useLocale();
  const regions = getLocalizedRegionFriendlyNames(locale);

  const handleRegionSelect = (regionName: string) => {
    setConfig({ ...config, selectedRegion: regionName });
    if (onRegionSelected) {
      onRegionSelected();
    }
  };

  return (
    <div className={`bg-white dark:bg-neutral-900 ${className}`}>
      <div className="text-center mb-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-2">
          {t("regionSelector.title")}
        </h2>
        <p className="text-gray-600 dark:text-gray-300">{t("regionSelector.description")}</p>
      </div>

      <div className="grid gap-3">
        {regions.map(({ name, friendlyName }) => (
          <button
            key={name}
            onClick={() => handleRegionSelect(name)}
            className="w-full p-4 text-left border border-gray-200 dark:border-neutral-700 rounded-lg hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors"
          >
            <div className="font-medium text-gray-800 dark:text-gray-100">{friendlyName}</div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {name === "krasnodar_pub" && `${t("regionSelector.broker")}: 192.168.1.20, ${t("regionSelector.baseTopic")}: meshcore/krr_pb`}
              {name === "stavropol" && `${t("regionSelector.broker")}: 192.168.1.20, ${t("regionSelector.baseTopic")}: meshcore/stv`}
            </div>
          </button>
        ))}
      </div>

      <div className="mt-6 text-center">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("regionSelector.footer")}
        </p>
      </div>
    </div>
  );
}
