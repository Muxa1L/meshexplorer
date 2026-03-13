"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { messages } from "@/i18n/messages";

const RADIO_SETTINGS = {
  frequency: "869.075012 МГц",
  bandwidth: "62.5 кГц",
  spreadingFactor: "8",
  codingRate: "8",
} as const;

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
    >
      {children}
    </a>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <article className={`overflow-hidden rounded-3xl border border-white/10 bg-white/80 shadow-xl shadow-black/10 backdrop-blur dark:bg-neutral-900/80 dark:shadow-black/30 ${className}`}>
      <div className="p-6 sm:p-8">{children}</div>
    </article>
  );
}

export default function JoinPage() {
  const { locale, t } = useLocale();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const content = messages[locale].joinPage;

  const copyText = useMemo(() => {
    return [
      t("joinPage.frequency"),
      RADIO_SETTINGS.frequency,
      t("joinPage.bandwidth"),
      RADIO_SETTINGS.bandwidth,
      t("joinPage.spreadingFactor"),
      RADIO_SETTINGS.spreadingFactor,
      t("joinPage.codingRate"),
      RADIO_SETTINGS.codingRate,
    ].join("\n");
  }, [t]);

  const copyButtonLabel = copyState === "copied"
    ? t("joinPage.copied")
    : copyState === "error"
      ? t("joinPage.copyError")
      : t("joinPage.copy");

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(copyText);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = copyText;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus({ preventScroll: true });
        textarea.select();
        const success = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (!success) {
          throw new Error("Copy blocked by browser/environment");
        }
      }

      setCopyState("copied");
    } catch {
      setCopyState("error");
      window.alert(t("joinPage.copyFailedAlert"));
    } finally {
      window.setTimeout(() => setCopyState("idle"), 1400);
    }
  };

  const concepts = content.concepts;
  const minimumNeeds = content.minimumNeeds;
  const flashSteps = content.flashSteps;
  const connectSteps = content.connectSteps;
  const afterItems = content.afterItems;

  return (
    <div className="min-h-screen overflow-y-auto bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_32%),radial-gradient(circle_at_top_right,rgba(34,197,94,0.1),transparent_26%),linear-gradient(to_bottom,rgba(248,250,252,1),rgba(241,245,249,1))] py-8 dark:bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_30%),radial-gradient(circle_at_top_right,rgba(6,182,212,0.12),transparent_24%),linear-gradient(to_bottom,rgba(10,15,28,1),rgba(17,24,39,1))]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
        <section className="px-1 py-2">
          <h1 className="text-3xl font-bold tracking-tight text-gray-950 dark:text-white sm:text-4xl">
            {t("joinPage.title")}
          </h1>
          <p className="mt-3 max-w-3xl text-base text-gray-600 dark:text-gray-300 sm:text-lg">
            {t("joinPage.subtitle")}
          </p>
        </section>

        <div className="grid gap-6">
          <Card>
            <h2 className="text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">
              {t("joinPage.whatIsTitle")}
            </h2>
            <p className="mt-3 text-gray-700 dark:text-gray-300">
              {t("joinPage.whatIsText")} {" "}
              <ExternalLink href="https://github.com/meshcore-dev/MeshCore">
                {t("joinPage.githubLabel")}
              </ExternalLink>
            </p>

            <h3 className="mt-6 text-sm font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
              {t("joinPage.conceptsTitle")}
            </h3>
            <ul className="mt-3 list-disc space-y-2 pl-6 text-gray-700 dark:text-gray-300">
              {concepts.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Card>

          <Card>
            <h2 className="text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">
              {t("joinPage.minimumTitle")}
            </h2>
            <ul className="mt-4 list-disc space-y-2 pl-6 text-gray-700 dark:text-gray-300">
              {minimumNeeds.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>

            <div className="my-6 h-px bg-gray-200 dark:bg-white/10" />

            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t("joinPage.entryPointsTitle")}
            </h3>
            <ul className="mt-3 list-disc space-y-2 pl-6 text-gray-700 dark:text-gray-300">
              <li>
                {t("joinPage.officialApps")}: {" "}
                <ExternalLink href="https://meshcore.co.uk/apps.html">https://meshcore.co.uk/apps.html</ExternalLink>
              </li>
              <li>
                {t("joinPage.webFlasher")}: {" "}
                <ExternalLink href="https://flasher.meshcore.dev/">https://flasher.meshcore.dev/</ExternalLink>
              </li>
              <li>
                {t("joinPage.projectReadme")}: {" "}
                <ExternalLink href="https://github.com/meshcore-dev/MeshCore">https://github.com/meshcore-dev/MeshCore</ExternalLink>
              </li>
            </ul>

            <div className="my-6 h-px bg-gray-200 dark:bg-white/10" />

            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t("joinPage.installClientTitle")}
            </h3>
            <ul className="mt-3 list-disc space-y-2 pl-6 text-gray-700 dark:text-gray-300">
              <li>
                {t("joinPage.webClient")}: {" "}
                <ExternalLink href="https://app.meshcore.nz">https://app.meshcore.nz</ExternalLink>
              </li>
              <li>
                {t("joinPage.androidClient")}: {" "}
                <ExternalLink href="https://play.google.com/store/apps/details?id=com.liamcottle.meshcore.android">
                  https://play.google.com/store/apps/details?id=com.liamcottle.meshcore.android
                </ExternalLink>
              </li>
              <li>
                {t("joinPage.iosClient")}: {" "}
                <ExternalLink href="https://apps.apple.com/us/app/meshcore/id6742354151?platform=iphone">
                  https://apps.apple.com/us/app/meshcore/id6742354151?platform=iphone
                </ExternalLink>
              </li>
            </ul>

            <div className="my-6 h-px bg-gray-200 dark:bg-white/10" />

            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t("joinPage.flashTitle")}
            </h3>
            <ul className="mt-3 list-disc space-y-2 pl-6 text-gray-700 dark:text-gray-300">
              {flashSteps.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>

            <div className="mt-5 rounded-2xl border-l-4 border-blue-400 bg-blue-50/80 p-4 text-gray-700 dark:border-blue-400/70 dark:bg-blue-500/10 dark:text-gray-200">
              {t("joinPage.bluetoothCallout")}
            </div>

            <div className="my-6 h-px bg-gray-200 dark:bg-white/10" />

            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t("joinPage.connectTitle")}
            </h3>
            <ul className="mt-3 list-disc space-y-2 pl-6 text-gray-700 dark:text-gray-300">
              {connectSteps.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Card>

          <Card>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <h2 className="text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">
                  {t("joinPage.radioTitle")}
                </h2>
                <p className="mt-2 max-w-3xl text-gray-600 dark:text-gray-300">
                  {t("joinPage.radioDescription")}
                </p>
              </div>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center justify-center rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-semibold tracking-wide text-gray-900 transition hover:bg-gray-50 dark:border-white/15 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
              >
                {copyButtonLabel}
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2" role="group" aria-label={t("joinPage.radioTitle")}>
              {[
                { label: t("joinPage.frequency"), value: RADIO_SETTINGS.frequency },
                { label: t("joinPage.bandwidth"), value: RADIO_SETTINGS.bandwidth },
                { label: t("joinPage.spreadingFactor"), value: RADIO_SETTINGS.spreadingFactor },
                { label: t("joinPage.codingRate"), value: RADIO_SETTINGS.codingRate },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="rounded-2xl border border-gray-200 bg-gray-50/80 p-4 dark:border-white/10 dark:bg-white/5"
                >
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                    {label}
                  </div>
                  <div className="mt-2 text-lg font-semibold text-gray-950 dark:text-white">
                    {value}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 flex gap-3 rounded-2xl border border-gray-200 bg-gray-50/80 p-4 text-gray-700 dark:border-white/10 dark:bg-white/5 dark:text-gray-300">
              <div className="text-lg font-bold text-blue-600 dark:text-blue-400">*</div>
              <p>{t("joinPage.advertNote")}</p>
            </div>

            <h3 className="mt-6 text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t("joinPage.afterTitle")}
            </h3>
            <ul className="mt-3 list-disc space-y-2 pl-6 text-gray-700 dark:text-gray-300">
              {afterItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}